use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use windows::core::{implement, Interface, BSTR, PCWSTR, PROPVARIANT};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::{
    eCapture, eConsole, eRender, ActivateAudioInterfaceAsync, EDataFlow,
    IActivateAudioInterfaceAsyncOperation,
    IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
    IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator,
    AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
    AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_LOOPBACK,
    AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, AUDIOCLIENT_ACTIVATION_PARAMS,
    AUDIOCLIENT_ACTIVATION_PARAMS_0,
    AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
    DEVICE_STATE_ACTIVE, PROCESS_LOOPBACK_MODE, PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, WAVEFORMATEX,
    WAVEFORMATEXTENSIBLE,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
};
use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForSingleObject};

const WAVE_FORMAT_IEEE_FLOAT: u16 = 0x0003;
const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;
const WAVE_FORMAT_PCM: u16 = 0x0001;

const SILENCE_TIMEOUT: Duration = Duration::from_millis(60);

const RESYNC_100NS: i64 = 1_000_000;

const VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK: PCWSTR =
    windows::core::w!("VAD\\Process_Loopback");

const PROCESS_SAMPLE_RATE: u32 = 48_000;
const PROCESS_CHANNELS: u16 = 2;

const ACTIVATION_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum AudioSource {
    #[default]
    DefaultDevice,
    Device(String),
    Process(u32),
    EverythingExcept(u32),
    Microphone(Option<String>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AudioFormat {
    pub sample_rate: u32,
    pub channels: u16,
}

impl AudioFormat {
    pub fn frame_count(&self, samples: usize) -> usize {
        samples / self.channels.max(1) as usize
    }
}

pub trait AudioSink: Send + 'static {
    fn on_samples(&mut self, samples: &[f32], timestamp_100ns: i64);
}

impl<F> AudioSink for F
where
    F: FnMut(&[f32], i64) + Send + 'static,
{
    fn on_samples(&mut self, samples: &[f32], timestamp_100ns: i64) {
        self(samples, timestamp_100ns)
    }
}

pub struct LoopbackCapture {
    running: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
    format: AudioFormat,
}

impl LoopbackCapture {
    pub fn start(sink: impl AudioSink) -> Result<Self> {
        Self::start_from(AudioSource::DefaultDevice, sink)
    }

    pub fn start_from(source: AudioSource, mut sink: impl AudioSink) -> Result<Self> {
        let (source, format) = probe_source(&source)?;

        log::info!(
            "Desktop audio: {source:?}, {} Hz, {} channels",
            format.sample_rate,
            format.channels
        );

        let running = Arc::new(AtomicBool::new(true));
        let thread_running = Arc::clone(&running);

        let thread = std::thread::Builder::new()
            .name("nrc-audio".into())
            .spawn(move || {
                if let Err(e) = capture_loop(&thread_running, &mut sink, &source, format) {
                    log::error!("Audio capture stopped: {e:#}");
                }
            })
            .context("could not start the audio thread")?;

        Ok(Self {
            running,
            thread: Some(thread),
            format,
        })
    }

    pub fn format(&self) -> AudioFormat {
        self.format
    }
}

impl Drop for LoopbackCapture {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

pub fn output_devices() -> Result<Vec<AudioDevice>> {
    devices(eRender)
}

pub fn input_devices() -> Result<Vec<AudioDevice>> {
    devices(eCapture)
}

fn devices(flow: EDataFlow) -> Result<Vec<AudioDevice>> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .context("could not create the audio device enumerator")?;

        let default_id = enumerator
            .GetDefaultAudioEndpoint(flow, eConsole)
            .ok()
            .and_then(|device| device.GetId().ok())
            .map(|id| {
                let text = id.to_string().unwrap_or_default();
                CoTaskMemFree(Some(id.0 as *const _));
                text
            });

        let collection = enumerator
            .EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE)
            .context("could not enumerate audio devices")?;

        let mut devices = Vec::new();
        for index in 0..collection.GetCount().unwrap_or(0) {
            let Ok(device) = collection.Item(index) else {
                continue;
            };
            let Ok(id) = device.GetId() else {
                continue;
            };
            let id_text = id.to_string().unwrap_or_default();
            CoTaskMemFree(Some(id.0 as *const _));
            if id_text.is_empty() {
                continue;
            }

            let name = friendly_name(&device).unwrap_or_else(|| id_text.clone());
            let is_default = default_id.as_deref() == Some(id_text.as_str());

            devices.push(AudioDevice {
                id: id_text,
                name,
                is_default,
            });
        }

        Ok(devices)
    }
}

unsafe fn friendly_name(device: &windows::Win32::Media::Audio::IMMDevice) -> Option<String> {
    let store = device.OpenPropertyStore(STGM_READ).ok()?;
    let value = store.GetValue(&PKEY_Device_FriendlyName).ok()?;

    let name = BSTR::try_from(&value).ok()?.to_string();
    (!name.is_empty()).then_some(name)
}

pub fn supports_process_capture() -> bool {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        match open_process_client(
            std::process::id(),
            PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
        ) {
            Ok(_) => true,
            Err(e) => {
                log::info!("Per-process audio capture is not available here: {e:#}");
                false
            }
        }
    }
}

pub fn probe_source(source: &AudioSource) -> Result<(AudioSource, AudioFormat)> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        match open_client(source) {
            Ok((_client, format)) => Ok((source.clone(), format)),
            Err(e) if *source != AudioSource::DefaultDevice => {
                log::warn!("{source:?} is unavailable, falling back to the default device: {e:#}");
                let (_client, format) = open_client(&AudioSource::DefaultDevice)?;
                Ok((AudioSource::DefaultDevice, format))
            }
            Err(e) => Err(e),
        }
    }
}

unsafe fn open_client(source: &AudioSource) -> Result<(IAudioClient, AudioFormat)> {
    match source {
        AudioSource::Process(pid) => {
            open_process_client(*pid, PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE)
        }
        AudioSource::EverythingExcept(pid) => {
            open_process_client(*pid, PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE)
        }
        AudioSource::Microphone(id) => open_microphone_client(id.as_deref()),
        AudioSource::DefaultDevice => open_device_client(None),
        AudioSource::Device(id) => open_device_client(Some(id)),
    }
}

unsafe fn open_device_client(id: Option<&str>) -> Result<(IAudioClient, AudioFormat)> {
    let enumerator: IMMDeviceEnumerator =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .context("could not create the audio device enumerator")?;

    let device = match id {
        Some(id) => {
            let wide: Vec<u16> = id.encode_utf16().chain(std::iter::once(0)).collect();
            enumerator
                .GetDevice(PCWSTR(wide.as_ptr()))
                .with_context(|| format!("audio device '{id}' is not available"))?
        }
        None => enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .context("no default audio output device")?,
    };

    let client: IAudioClient = device
        .Activate(CLSCTX_ALL, None)
        .context("could not activate the audio client")?;

    let mix_format = client
        .GetMixFormat()
        .context("could not read the device mix format")?;
    if mix_format.is_null() {
        bail!("the device reported no mix format");
    }

    let format = describe(&*mix_format)?;

    let result = client.Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
        2_000_000,
        0,
        mix_format,
        None,
    );

    CoTaskMemFree(Some(mix_format as *const _));
    result.context("could not initialise the audio client for loopback")?;

    Ok((client, format))
}

unsafe fn open_microphone_client(id: Option<&str>) -> Result<(IAudioClient, AudioFormat)> {
    let enumerator: IMMDeviceEnumerator =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .context("could not create the audio device enumerator")?;

    let device = match id {
        Some(id) => {
            let wide: Vec<u16> = id.encode_utf16().chain(std::iter::once(0)).collect();
            enumerator
                .GetDevice(PCWSTR(wide.as_ptr()))
                .with_context(|| format!("microphone '{id}' is not available"))?
        }
        None => enumerator
            .GetDefaultAudioEndpoint(eCapture, eConsole)
            .context("no default microphone")?,
    };

    let client: IAudioClient = device
        .Activate(CLSCTX_ALL, None)
        .context("could not activate the microphone")?;

    let format = AudioFormat {
        sample_rate: PROCESS_SAMPLE_RATE,
        channels: PROCESS_CHANNELS,
    };
    let wave = wave_format(format);

    client
        .Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_EVENTCALLBACK
                | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
                | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
            2_000_000,
            0,
            &wave.Format,
            None,
        )
        .context("could not initialise the microphone")?;

    Ok((client, format))
}

unsafe fn open_process_client(
    pid: u32,
    mode: PROCESS_LOOPBACK_MODE,
) -> Result<(IAudioClient, AudioFormat)> {
    let format = AudioFormat {
        sample_rate: PROCESS_SAMPLE_RATE,
        channels: PROCESS_CHANNELS,
    };

    let mut activation = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: pid,
                ProcessLoopbackMode: mode,
            },
        },
    };

    let parameters = PropVariantBlob {
        vt: VT_BLOB,
        reserved1: 0,
        reserved2: 0,
        reserved3: 0,
        cb_size: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
        _padding: 0,
        blob_data: &mut activation as *mut _ as *mut u8,
    };

    let done: HANDLE =
        CreateEventW(None, false, false, None).context("could not create the activation event")?;
    let guard = EventGuard(done);

    let handler: IActivateAudioInterfaceCompletionHandler = ActivationHandler { done }.into();

    let operation = ActivateAudioInterfaceAsync(
        VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        &IAudioClient::IID,
        Some(&parameters as *const PropVariantBlob as *const PROPVARIANT),
        &handler,
    )
    .context("this Windows version does not support capturing a single process")?;

    if WaitForSingleObject(guard.0, ACTIVATION_TIMEOUT.as_millis() as u32) != WAIT_OBJECT_0 {
        bail!("Windows did not answer the per-process audio request in time");
    }

    let mut status = windows::core::HRESULT(0);
    let mut interface: Option<windows::core::IUnknown> = None;
    operation
        .GetActivateResult(&mut status, &mut interface)
        .context("could not read the per-process audio result")?;
    status
        .ok()
        .context("Windows refused the per-process audio request")?;

    let client: IAudioClient = interface
        .context("per-process activation returned nothing")?
        .cast()
        .context("per-process activation returned the wrong interface")?;

    let wave = wave_format(format);
    client
        .Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
            2_000_000,
            0,
            &wave.Format,
            None,
        )
        .context("could not initialise per-process audio capture")?;

    Ok((client, format))
}

fn wave_format(format: AudioFormat) -> WAVEFORMATEXTENSIBLE {
    let channels = format.channels.max(1);
    let bits = 32u16;
    let block_align = channels * bits / 8;

    WAVEFORMATEXTENSIBLE {
        Format: WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_IEEE_FLOAT,
            nChannels: channels,
            nSamplesPerSec: format.sample_rate,
            nAvgBytesPerSec: format.sample_rate * block_align as u32,
            nBlockAlign: block_align,
            wBitsPerSample: bits,
            cbSize: 0,
        },
        ..Default::default()
    }
}

const VT_BLOB: u16 = 65;

#[repr(C)]
struct PropVariantBlob {
    vt: u16,
    reserved1: u16,
    reserved2: u16,
    reserved3: u16,
    cb_size: u32,
    _padding: u32,
    blob_data: *mut u8,
}

const _: () = assert!(std::mem::size_of::<PropVariantBlob>() == std::mem::size_of::<PROPVARIANT>());

#[implement(IActivateAudioInterfaceCompletionHandler)]
struct ActivationHandler {
    done: HANDLE,
}

impl IActivateAudioInterfaceCompletionHandler_Impl for ActivationHandler_Impl {
    fn ActivateCompleted(
        &self,
        _operation: Option<&IActivateAudioInterfaceAsyncOperation>,
    ) -> windows::core::Result<()> {
        unsafe { SetEvent(self.done) }
    }
}

struct EventGuard(HANDLE);

impl Drop for EventGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

unsafe fn describe(format: &WAVEFORMATEX) -> Result<AudioFormat> {
    let format_tag = std::ptr::addr_of!(format.wFormatTag).read_unaligned();
    let bits_per_sample = std::ptr::addr_of!(format.wBitsPerSample).read_unaligned();
    let samples_per_sec = std::ptr::addr_of!(format.nSamplesPerSec).read_unaligned();
    let channels = std::ptr::addr_of!(format.nChannels).read_unaligned();

    let tag = match format_tag {
        WAVE_FORMAT_EXTENSIBLE => {
            let extensible = format as *const WAVEFORMATEX as *const WAVEFORMATEXTENSIBLE;
            let sub = std::ptr::addr_of!((*extensible).SubFormat.data1).read_unaligned();
            match sub as u16 {
                WAVE_FORMAT_IEEE_FLOAT => WAVE_FORMAT_IEEE_FLOAT,
                WAVE_FORMAT_PCM => WAVE_FORMAT_PCM,
                other => bail!("unsupported audio sub-format {other:#x}"),
            }
        }
        other => other,
    };

    if tag != WAVE_FORMAT_IEEE_FLOAT {
        bail!("device mix format is not 32-bit float ({bits_per_sample} bits, tag {tag:#x})");
    }
    if bits_per_sample != 32 {
        bail!("expected 32-bit samples, got {bits_per_sample}");
    }

    Ok(AudioFormat {
        sample_rate: samples_per_sec,
        channels,
    })
}

fn capture_loop(
    running: &AtomicBool,
    sink: &mut impl AudioSink,
    source: &AudioSource,
    format: AudioFormat,
) -> Result<()> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let (client, _) = open_client(source)?;

        let event: HANDLE =
            CreateEventW(None, false, false, None).context("could not create the audio event")?;
        client
            .SetEventHandle(event)
            .context("could not attach the audio event")?;

        let capture: IAudioCaptureClient = client
            .GetService()
            .context("could not get the capture service")?;

        client.Start().context("could not start audio capture")?;
        log::debug!("Audio capture running");

        let mut silence = Vec::<f32>::new();

        let mut next_timestamp: Option<i64> = Some(qpc_100ns());
        let mut clock = StreamClock::default();

        while running.load(Ordering::Relaxed) {
            let wait = WaitForSingleObject(event, SILENCE_TIMEOUT.as_millis() as u32);

            if wait != WAIT_OBJECT_0 {
                if let Some(timestamp) = next_timestamp {
                    let frames = (format.sample_rate as u64 * SILENCE_TIMEOUT.as_millis() as u64
                        / 1000) as usize;
                    let samples = frames * format.channels as usize;
                    silence.clear();
                    silence.resize(samples, 0.0);
                    sink.on_samples(&silence, timestamp);
                    clock.advance(timestamp, frames, format.sample_rate);
                    next_timestamp = Some(timestamp + span_100ns(frames, format.sample_rate));
                }
                continue;
            }

            loop {
                let available = capture
                    .GetNextPacketSize()
                    .context("GetNextPacketSize failed")?;
                if available == 0 {
                    break;
                }

                let mut data: *mut u8 = std::ptr::null_mut();
                let mut frames = 0u32;
                let mut flags = 0u32;
                let mut qpc_position = 0u64;

                capture
                    .GetBuffer(
                        &mut data,
                        &mut frames,
                        &mut flags,
                        None,
                        Some(&mut qpc_position),
                    )
                    .context("GetBuffer failed")?;

                let samples = frames as usize * format.channels as usize;
                let observed = qpc_position as i64;
                let lost = flags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY.0 as u32 != 0;

                let before = clock.resynced();
                let timestamp =
                    clock.place(observed, frames as usize, format.sample_rate, lost);
                if clock.resynced() != before {
                    log::debug!(
                        "Audio clock resynchronised ({} ms out{})",
                        (observed - timestamp) / 10_000,
                        if lost { ", packets were dropped" } else { "" },
                    );
                }

                if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 {
                    silence.clear();
                    silence.resize(samples, 0.0);
                    sink.on_samples(&silence, timestamp);
                } else if !data.is_null() && samples > 0 {
                    let slice = std::slice::from_raw_parts(data as *const f32, samples);
                    sink.on_samples(slice, timestamp);
                }

                next_timestamp = Some(timestamp + span_100ns(frames as usize, format.sample_rate));

                capture
                    .ReleaseBuffer(frames)
                    .context("ReleaseBuffer failed")?;
            }
        }

        let _ = client.Stop();
        let _ = CloseHandle(event);
        if clock.resynced() > 0 {
            log::info!(
                "Audio capture stopped after {} clock resynchronisation(s)",
                clock.resynced()
            );
        } else {
            log::debug!("Audio capture stopped");
        }
        Ok(())
    }
}

fn span_100ns(frames: usize, sample_rate: u32) -> i64 {
    frames as i64 * 10_000_000 / sample_rate.max(1) as i64
}

#[derive(Debug, Default)]
struct StreamClock {
    next: Option<i64>,
    resyncs: u64,
}

impl StreamClock {
    fn place(&mut self, observed: i64, frames: usize, sample_rate: u32, lost: bool) -> i64 {
        let at = match self.next {
            Some(_) if lost => {
                self.resyncs += 1;
                observed
            }
            Some(expected) if (observed - expected).abs() > RESYNC_100NS => {
                self.resyncs += 1;
                observed
            }
            Some(expected) => expected,
            None => observed,
        };

        self.next = Some(at + span_100ns(frames, sample_rate));
        at
    }

    fn advance(&mut self, at: i64, frames: usize, sample_rate: u32) {
        self.next = Some(at + span_100ns(frames, sample_rate));
    }

    fn resynced(&self) -> u64 {
        self.resyncs
    }
}

fn qpc_100ns() -> i64 {
    use std::sync::OnceLock;
    use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};

    static FREQUENCY: OnceLock<i64> = OnceLock::new();
    let frequency = *FREQUENCY.get_or_init(|| {
        let mut frequency = 0i64;
        unsafe {
            let _ = QueryPerformanceFrequency(&mut frequency);
        }
        frequency
    });
    if frequency == 0 {
        return 0;
    }

    let mut counter = 0i64;
    unsafe {
        let _ = QueryPerformanceCounter(&mut counter);
    }
    (counter as i128 * 10_000_000 / frequency as i128) as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_count_divides_by_channels() {
        let stereo = AudioFormat {
            sample_rate: 48_000,
            channels: 2,
        };
        assert_eq!(stereo.frame_count(2048), 1024);

        let mono = AudioFormat {
            sample_rate: 48_000,
            channels: 1,
        };
        assert_eq!(mono.frame_count(1024), 1024);
    }

    #[test]
    fn a_zero_channel_format_does_not_divide_by_zero() {
        let broken = AudioFormat {
            sample_rate: 48_000,
            channels: 0,
        };
        assert_eq!(broken.frame_count(1024), 1024);
    }

    const RATE: u32 = 48_000;
    const PACKET: usize = 480;

    fn step() -> i64 {
        span_100ns(PACKET, RATE)
    }

    #[test]
    fn the_first_packet_lands_where_the_device_says() {
        let mut clock = StreamClock::default();
        assert_eq!(clock.place(12_345, PACKET, RATE, false), 12_345);
    }

    #[test]
    fn jitter_in_the_device_reading_does_not_move_the_samples() {
        let mut clock = StreamClock::default();
        let start = 1_000_000;
        clock.place(start, PACKET, RATE, false);

        let wobble = [37, -12, 0, 39, -25, 4, -39, 18];
        for (i, off) in wobble.iter().enumerate() {
            let nominal = start + step() * (i as i64 + 1);
            let observed = nominal + off * 10_000_000 / RATE as i64;
            let placed = clock.place(observed, PACKET, RATE, false);
            assert_eq!(
                placed, nominal,
                "packet {i} was pulled off its position by the device's jitter",
            );
        }
        assert_eq!(clock.resynced(), 0, "jitter must not count as a resync");
    }

    #[test]
    fn placements_leave_neither_hole_nor_overlap() {
        let mut clock = StreamClock::default();
        let start = 500_000;
        let mut previous_end = None;

        for i in 0..200 {
            let observed = start + step() * i + (i % 7) * 3_000 - 9_000;
            let at = clock.place(observed, PACKET, RATE, false);
            if let Some(end) = previous_end {
                assert_eq!(at, end, "packet {i} does not start where the last one ended");
            }
            previous_end = Some(at + step());
        }
    }

    #[test]
    fn a_reading_far_from_the_count_is_believed() {
        let mut clock = StreamClock::default();
        clock.place(0, PACKET, RATE, false);

        let jumped = clock.place(5_000_000, PACKET, RATE, false);
        assert_eq!(jumped, 5_000_000);
        assert_eq!(clock.resynced(), 1);

        assert_eq!(clock.place(5_000_000 + step(), PACKET, RATE, false), 5_000_000 + step());
        assert_eq!(clock.resynced(), 1);
    }

    #[test]
    fn admitted_packet_loss_is_believed_however_small() {
        let mut clock = StreamClock::default();
        clock.place(0, PACKET, RATE, false);

        let after = clock.place(step() + 50_000, PACKET, RATE, true);
        assert_eq!(after, step() + 50_000);
        assert_eq!(clock.resynced(), 1);
    }

    #[test]
    fn slow_drift_is_corrected_rarely_rather_than_continuously() {
        let mut clock = StreamClock::default();
        clock.place(0, PACKET, RATE, false);

        let packets = 60 * 60 * RATE as i64 / PACKET as i64;
        let mut moved = 0;
        let mut previous_end = step();

        for i in 1..packets {
            let observed = step() * i + step() * i * 40 / 1_000_000;
            let at = clock.place(observed, PACKET, RATE, false);
            if at != previous_end {
                moved += 1;
            }
            previous_end = at + step();
        }

        assert_eq!(
            moved,
            clock.resynced(),
            "the stream may only jump where a resync was declared",
        );
        assert!(
            clock.resynced() <= 2,
            "an hour of ordinary drift should need at most a correction or two, not {}",
            clock.resynced(),
        );
        assert!(
            clock.resynced() >= 1,
            "drift has to be corrected eventually or audio walks away from video",
        );
    }

    #[test]
    fn drift_below_the_threshold_is_ignored_entirely() {
        let mut clock = StreamClock::default();
        clock.place(0, PACKET, RATE, false);

        let packets = 10 * 60 * RATE as i64 / PACKET as i64;
        for i in 1..packets {
            let nominal = step() * i;
            let observed = nominal + nominal * 40 / 1_000_000;
            assert_eq!(
                clock.place(observed, PACKET, RATE, false),
                nominal,
                "packet {i} was moved by drift",
            );
        }
        assert_eq!(clock.resynced(), 0);
    }

    #[test]
    fn injected_silence_is_counted_as_part_of_the_stream() {
        let mut clock = StreamClock::default();
        let at = clock.place(0, PACKET, RATE, false);

        let filler_start = at + step();
        clock.advance(filler_start, RATE as usize / 10, RATE);

        let expected = filler_start + span_100ns(RATE as usize / 10, RATE);
        assert_eq!(clock.place(expected + 5_000, PACKET, RATE, false), expected);
    }

    #[test]
    fn a_span_is_measured_from_the_frames_not_the_clock() {
        assert_eq!(span_100ns(48_000, 48_000), 10_000_000);
        assert_eq!(span_100ns(480, 48_000), 100_000);
        assert_eq!(span_100ns(0, 48_000), 0);
    }

    #[test]
    fn a_zero_sample_rate_does_not_divide_by_zero() {
        assert_eq!(span_100ns(480, 0), 480 * 10_000_000);
    }
}
