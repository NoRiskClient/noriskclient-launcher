use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use norisk_ipc::{CaptureMethod, CaptureState, ErrorCode};

use super::audio::{start_audio, AudioPipeline};
use super::target::Target;
use super::{Engine, MIN_CAPTURE_SIDE};
use crate::buffer::RingBuffer;
use crate::capture::{fit_output, window, BgraFrame, CaptureDevice, CaptureSession, Converter, FrameSink};
use crate::encoder::{
    video::TIME_BASE_DEN, EncoderSettings, HwFramePool, PoolFrame, VideoEncoder,
};

const FAILURE_LOG_EVERY: u64 = 600;
const ENCODE_QUEUE_DEPTH: usize = 4;

pub(super) enum FrameSource {
    Window(CaptureSession),
    Hook(Box<crate::capture::hook::HookCapture>),
}

impl FrameSource {
    pub(super) fn adapter(&self) -> &str {
        match self {
            Self::Window(session) => session.adapter(),
            Self::Hook(hook) => hook.adapter(),
        }
    }

    pub(super) fn has_stopped(&self) -> bool {
        match self {
            Self::Window(_) => false,
            Self::Hook(hook) => hook.has_stopped(),
        }
    }

    pub(super) fn state(&self) -> CaptureState {
        match self {
            Self::Window(session) => session.state(),
            Self::Hook(_) => CaptureState::Buffering,
        }
    }

    pub(super) fn stats(&self) -> crate::capture::CaptureStats {
        match self {
            Self::Window(session) => session.stats(),
            Self::Hook(hook) => crate::capture::CaptureStats {
                received: hook.frames_delivered(),
                delivered: hook.frames_delivered(),
                gated: 0,
                size_changes: 0,
            },
        }
    }

    pub(super) fn method(&self) -> CaptureMethod {
        match self {
            Self::Window(session) if session.is_screen() => CaptureMethod::ScreenCapture,
            Self::Window(_) => CaptureMethod::WindowCapture,
            Self::Hook(_) => CaptureMethod::GraphicsHook,
        }
    }
}

pub(super) struct Pipeline {
    pub(super) device: CaptureDevice,
    pub(super) hidden: Arc<AtomicBool>,
    pub(super) source: FrameSource,
    pub(super) encode_thread: Option<std::thread::JoinHandle<()>>,
    pub(super) encode_done: Receiver<()>,
    pub(super) frames_tx: Option<SyncSender<PoolFrame>>,
    pub(super) ring: Arc<Mutex<RingBuffer>>,
    pub(super) extradata: Vec<u8>,
    pub(super) dropped: Arc<AtomicU64>,
    pub(super) encode_latency: LatencyWindow,
    pub(super) settings: EncoderSettings,
    pub(super) encoder: norisk_ipc::EncoderPreference,
    pub(super) audio: Option<AudioPipeline>,
    pub(super) target: Target,
    pub(super) started: Instant,
}

pub(super) type LatencyWindow = Arc<Mutex<VecDeque<u32>>>;

const LATENCY_SAMPLES: usize = 240;

impl Engine {
    fn choose_encoder(&self) -> Result<(norisk_ipc::ClipCodec, norisk_ipc::EncoderPreference)> {
        let matrix = crate::encoder::capabilities();
        let requested = self.config.codec;

        let Some((codec, encoder)) =
            norisk_ipc::select_encoder(requested, self.config.encoder, &matrix)
        else {
            anyhow::bail!("this machine has no usable video encoder for any codec");
        };

        if codec != requested {
            log::warn!("{requested:?} cannot be encoded on this machine; recording in {codec:?} instead");
        }
        if encoder != self.config.encoder && self.config.encoder != norisk_ipc::EncoderPreference::Auto
        {
            log::warn!(
                "{:?} is not usable on this machine; recording with {encoder:?} instead",
                self.config.encoder
            );
        }

        log::info!("Recording {codec:?} with {encoder:?}");
        Ok((codec, encoder))
    }

    pub(super) fn attach(&mut self, target: Target) -> Result<()> {
        log::info!("Attaching to {}", target.label());
        self.keyframe_warned.set(false);
        self.empty_warned.set(false);

        let (codec, chosen) = self.choose_encoder()?;
        let (width, height) = self.output_size(&target)?;

        let settings = EncoderSettings {
            width,
            height,
            fps: self.config.fps,
            bitrate_kbps: self.config.bitrate_kbps,
            gop_seconds: self.config.gop_seconds,
            codec,
        };

        let (device, hooked) = pick_device_and_hook(&target, settings.fps)?;

        let pool = HwFramePool::new(&device, settings.width, settings.height)?;
        let (encoder, settings, chosen) = open_encoder(&pool, settings, chosen, &device.adapter_name)?;
        let extradata = encoder.extradata();
        let black = black_frame(&device, &pool, settings.fps)
            .inspect_err(|e| log::debug!("No black picture for a minimised game, holding its last frame instead: {e:#}"))
            .ok();
        let hidden = Arc::new(AtomicBool::new(false));

        let converter = if let Ok((_, texture)) = &hooked {
            let mut converter =
                Converter::new(&device, (settings.width, settings.height), settings.fps)?;
            converter.set_flip_vertical(texture.flip);
            converter
        } else {
            Converter::for_window(
                &device,
                (settings.width, settings.height),
                settings.fps,
                match &target {
                    Target::Window(window) => Some(window.hwnd),
                    Target::Screen(_) => None,
                },
            )?
        };

        let ring = Arc::new(Mutex::new(RingBuffer::new(
            self.config.buffer_seconds as f32,
            TIME_BASE_DEN as i64,
        )));
        let dropped = Arc::new(AtomicU64::new(0));
        let fps = self.config.fps.max(1);
        let (frames_tx, frames_rx) = std::sync::mpsc::sync_channel::<PoolFrame>(ENCODE_QUEUE_DEPTH);

        let encode_latency: LatencyWindow = Arc::new(Mutex::new(
            VecDeque::with_capacity(LATENCY_SAMPLES),
        ));
        let (encode_done_tx, encode_done) = std::sync::mpsc::channel::<()>();
        let encode_thread = {
            let ring = Arc::clone(&ring);
            let latency = Arc::clone(&encode_latency);
            let hidden = Arc::clone(&hidden);
            std::thread::Builder::new()
                .name("nrc-encode".into())
                .spawn(move || {
                    let _done = encode_done_tx;
                    encode_loop(encoder, frames_rx, ring, fps, latency, black, hidden)
                })
                .context("could not start the encode thread")?
        };

        let epoch = Arc::new(AtomicI64::new(i64::MIN));
        let epoch_for_audio = Arc::clone(&epoch);
        let sink_dropped = Arc::clone(&dropped);
        let sink_tx = frames_tx.clone();
        let failures = AtomicU64::new(0);
        let failed = move |what: &str, e: anyhow::Error| {
            let seen = failures.fetch_add(1, Ordering::Relaxed);
            if seen % FAILURE_LOG_EVERY == 0 {
                log::warn!("A frame was dropped because {what} failed ({} so far): {e:#}", seen + 1);
            }
        };

        let sink = move |frame: BgraFrame<'_>| {
                let _ = epoch.compare_exchange(
                    i64::MIN,
                    frame.timestamp_100ns,
                    Ordering::Relaxed,
                    Ordering::Relaxed,
                );
                let base = epoch.load(Ordering::Relaxed);

                let mut pool_frame = match pool.acquire() {
                    Ok(pool_frame) => pool_frame,
                    Err(e) => {
                        sink_dropped.fetch_add(1, Ordering::Relaxed);
                        failed("taking a frame from the pool", e);
                        return;
                    }
                };
                {
                    let (texture, slice) = pool_frame.target();
                    if let Err(e) =
                        converter.convert(frame.texture, (frame.width, frame.height), texture, slice)
                    {
                        sink_dropped.fetch_add(1, Ordering::Relaxed);
                        failed("converting the picture", e);
                        return;
                    }
                }
                pool_frame.set_pts(rebase_pts(frame.timestamp_100ns, base));

                if let Err(TrySendError::Full(_) | TrySendError::Disconnected(_)) =
                    sink_tx.try_send(pool_frame)
                {
                    sink_dropped.fetch_add(1, Ordering::Relaxed);
                }
        };

        let health_device = device.clone();
        let source = start_source(device, hooked, &target, settings.fps, sink)?;

        let audio = if self.config.capture_audio {
            match start_audio(
                self.config.buffer_seconds as f32,
                self.audio_plan(target.pid()),
                Arc::clone(&epoch_for_audio),
                self.config.microphone_denoise,
            ) {
                Ok(pipeline) => Some(pipeline),
                Err(e) => {
                    log::warn!("Desktop audio unavailable, recording video only: {e:#}");
                    self.emit_error(
                        ErrorCode::AudioDevice,
                        format!("{e:#}"),
                        true,
                    );
                    None
                }
            }
        } else {
            None
        };

        log::info!("Attached to {} via {:?}", target.label(), source.method());

        self.active = Some(Pipeline {
            device: health_device,
            hidden,
            target,
            audio,
            source,
            encode_thread: Some(encode_thread),
            encode_done,
            frames_tx: Some(frames_tx),
            ring,
            extradata,
            dropped,
            encode_latency,
            settings,
            encoder: chosen,
            started: Instant::now(),
        });
        Ok(())
    }

    fn output_size(&self, target: &Target) -> Result<(u32, u32)> {
        let Some(source) = target.size() else {
            anyhow::bail!(
                "{} is minimised or has no drawable area, so there is nothing to record yet",
                target.label(),
            );
        };

        if source.0 < MIN_CAPTURE_SIDE || source.1 < MIN_CAPTURE_SIDE {
            anyhow::bail!(
                "{} is only {}x{} on screen, too small to record — it is probably minimised",
                target.label(),
                source.0,
                source.1,
            );
        }

        let (width, height) = fit_output(source, (self.config.width, self.config.height));
        if (width, height) != (self.config.width, self.config.height) {
            log::info!(
                "Recording at {width}x{height}: the game renders {}x{} and the preset caps at {}x{}",
                source.0,
                source.1,
                self.config.width,
                self.config.height
            );
        }
        Ok((width, height))
    }
}

type Hooked = Result<(crate::capture::hook::HookSession, crate::capture::hook::HookTexture)>;

fn pick_device_and_hook(target: &Target, fps: u32) -> Result<(CaptureDevice, Hooked)> {
    Ok(match target {
        Target::Window(window) => match hook_handshake(window, fps) {
            Ok((session, texture)) => {
                match CaptureDevice::new_for_shared_texture(window.hwnd, texture.handle) {
                    Ok(device) => (device, Ok((session, texture))),
                    Err(e) => (CaptureDevice::new_for_window(window.hwnd)?, Err(e)),
                }
            }
            Err(e) => (CaptureDevice::new_for_window(window.hwnd)?, Err(e)),
        },
        Target::Screen(screen) => (
            CaptureDevice::new_for_monitor(screen.monitor)?,
            Err(anyhow::anyhow!("a screen is recorded as it is shown")),
        ),
    })
}

fn start_source(
    device: CaptureDevice,
    hooked: Hooked,
    target: &Target,
    fps: u32,
    sink: impl FrameSink,
) -> Result<FrameSource> {
    Ok(match hooked {
        Ok((session, texture)) => {
            log::info!(
                "Recording through the graphics hook: {}x{}{}",
                texture.width,
                texture.height,
                if texture.flip { ", flipped" } else { "" }
            );
            FrameSource::Hook(Box::new(crate::capture::hook::HookCapture::start(
                device,
                session,
                texture,
                fps,
                sink,
            )?))
        }
        Err(e) => {
            let capture = match target {
                Target::Window(window) => {
                    log::warn!("Graphics hook unavailable, falling back to window capture: {e:#}");
                    crate::capture::wgc::Source::Window(window.hwnd)
                }
                Target::Screen(screen) => crate::capture::wgc::Source::Screen(screen.monitor),
            };
            FrameSource::Window(CaptureSession::start(device, capture, fps, sink)?)
        }
    })
}

const REPEAT_AFTER_FRAMES: u32 = 2;

fn encode_loop(
    mut encoder: VideoEncoder,
    frames: Receiver<PoolFrame>,
    ring: Arc<Mutex<RingBuffer>>,
    fps: u32,
    latency: LatencyWindow,
    mut black: Option<PoolFrame>,
    hidden: Arc<AtomicBool>,
) {
    use std::sync::mpsc::RecvTimeoutError;

    let fps = fps.max(1) as i64;
    let step = (TIME_BASE_DEN as i64 / fps).max(1);
    let wait =
        std::time::Duration::from_nanos((1_000_000_000 / fps as u64) * REPEAT_AFTER_FRAMES as u64);

    let report_after = (fps / REPEAT_AFTER_FRAMES as i64).max(1) as u64;

    let started = Instant::now();
    let mut last: Option<PoolFrame> = None;
    let mut last_pts = i64::MIN;
    let mut repeats: u64 = 0;
    let mut reported = false;

    let emit = |encoder: &mut VideoEncoder, frame: &PoolFrame| -> bool {
        let started = Instant::now();
        match encoder.encode(frame) {
            Ok(packets) => {
                let micros = started.elapsed().as_micros().min(u32::MAX as u128) as u32;
                {
                    let mut window = latency.lock().unwrap_or_else(|e| e.into_inner());
                    if window.len() == LATENCY_SAMPLES {
                        window.pop_front();
                    }
                    window.push_back(micros);
                }
                let mut guard = ring.lock().unwrap_or_else(|e| e.into_inner());
                for packet in packets {
                    guard.push(packet);
                }
                true
            }
            Err(e) => {
                log::error!("Encoding failed: {e:#}");
                false
            }
        }
    };

    loop {
        if crate::fault::due("encoder", started) {
            log::error!("Encoding failed: simulated because NRC_FAULT=encoder is set");
            return;
        }
        match frames.recv_timeout(wait) {
            Ok(mut frame) => {
                if reported {
                    log::debug!("The source drew again after {repeats} repeated frame(s)");
                    reported = false;
                }
                repeats = 0;

                if frame.pts() <= last_pts {
                    frame.set_pts(last_pts + 1);
                }
                let pts = frame.pts();

                let shown = match black.as_mut() {
                    Some(black) if hidden.load(Ordering::Relaxed) => {
                        black.set_pts(pts);
                        &*black
                    }
                    _ => &frame,
                };
                if !emit(&mut encoder, shown) {
                    return;
                }
                last_pts = pts;
                last = Some(frame);
            }
            Err(RecvTimeoutError::Timeout) => {
                let Some(frame) = last.as_mut() else { continue };

                last_pts += step;
                let shown = match black.as_mut() {
                    Some(black) if hidden.load(Ordering::Relaxed) => black,
                    _ => frame,
                };
                shown.set_pts(last_pts);
                if !emit(&mut encoder, shown) {
                    return;
                }

                repeats += 1;
                if repeats == report_after {
                    log::debug!("The source has not drawn for about a second; holding its last frame");
                    reported = true;
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    if let Ok(packets) = encoder.finish() {
        let mut guard = ring.lock().unwrap_or_else(|e| e.into_inner());
        for packet in packets {
            guard.push(packet);
        }
    }
}

fn rebase_pts(timestamp_100ns: i64, epoch_100ns: i64) -> i64 {
    ((timestamp_100ns.saturating_sub(epoch_100ns)) as i128 * TIME_BASE_DEN as i128 / 10_000_000)
        as i64
}

fn black_frame(device: &CaptureDevice, pool: &HwFramePool, fps: u32) -> Result<PoolFrame> {
    use windows::Win32::Graphics::Direct3D11::{
        D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE, D3D11_SUBRESOURCE_DATA,
        D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT,
    };
    use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};

    const SIDE: u32 = 16;
    let pixels = [0u8, 0, 0, 255].repeat((SIDE * SIDE) as usize);
    let desc = D3D11_TEXTURE2D_DESC {
        Width: SIDE,
        Height: SIDE,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
        ..Default::default()
    };
    let data = D3D11_SUBRESOURCE_DATA {
        pSysMem: pixels.as_ptr() as *const _,
        SysMemPitch: SIDE * 4,
        SysMemSlicePitch: 0,
    };

    let mut texture = None;
    unsafe { device.device.CreateTexture2D(&desc, Some(&data), Some(&mut texture)) }
        .context("could not make a black picture")?;
    let texture = texture.context("the black picture came back empty")?;

    let frame = pool.acquire()?;
    let (target, slice) = frame.target();
    Converter::new(device, (pool.width(), pool.height()), fps)?.convert(
        &texture,
        (SIDE, SIDE),
        target,
        slice,
    )?;
    Ok(frame)
}

fn open_encoder(
    pool: &HwFramePool,
    settings: EncoderSettings,
    preferred: norisk_ipc::EncoderPreference,
    adapter: &str,
) -> Result<(VideoEncoder, EncoderSettings, norisk_ipc::EncoderPreference)> {
    use norisk_ipc::{ClipCodec, EncoderPreference};

    let matrix = crate::encoder::capabilities();
    let first = (settings.codec, preferred);
    let mut tries = vec![first];
    for other in matrix
        .iter()
        .filter(|c| c.codec == settings.codec && c.available && c.hardware)
        .map(|c| (c.codec, c.encoder))
        .chain([(settings.codec, EncoderPreference::Software), (ClipCodec::H264, EncoderPreference::Software)])
    {
        if !tries.contains(&other) {
            tries.push(other);
        }
    }

    let mut last = None;
    for (codec, encoder) in tries {
        let Some(name) = crate::encoder::encoder_name(codec, encoder) else {
            continue;
        };
        let settings = EncoderSettings { codec, ..settings };
        match VideoEncoder::open(name, pool, settings) {
            Ok(opened) if !opened.extradata().is_empty() => {
                if (codec, encoder) != first {
                    log::warn!("Recording with {name} on '{adapter}' instead of the encoder picked first");
                }
                return Ok((opened, settings, encoder));
            }
            Ok(_) => {
                log::warn!("{name} opened on '{adapter}' but gave no codec header; trying the next encoder");
            }
            Err(e) => {
                log::warn!("{name} would not open on '{adapter}': {e:#}; trying the next encoder");
                last = Some(e);
            }
        }
    }

    Err(last.unwrap_or_else(|| anyhow::anyhow!("no encoder could be opened")))
}

fn hook_handshake(
    target: &window::GameWindow,
    fps: u32,
) -> Hooked {
    use crate::capture::hook::{self, HookStep};
    const BUDGET: Duration = Duration::from_millis(6_000);

    let dll = hook::locate_hook_dll()?;

    let mut session = hook::HookSession::new(target.pid, target.hwnd, fps)?;

    let started = Instant::now();
    let injected = hook::inject(target.pid, window::thread_of(target.hwnd), &dll)
        .with_context(|| format!("could not load the hook into process {}", target.pid))?;

    match injected {
        hook::Injected::Loaded => {
            log::info!("Loaded the graphics hook into process {}", target.pid)
        }
        hook::Injected::AlreadyPresent => log::info!(
            "The graphics hook was already in process {} — sharing it with whatever put it there",
            target.pid
        ),
    }

    loop {
        match session.poll() {
            HookStep::Ready(texture) => {
                log::info!(
                    "Graphics hook ready in {:.0} ms",
                    started.elapsed().as_secs_f64() * 1000.0
                );
                return Ok((session, texture));
            }
            HookStep::Failed(e) => return Err(e),
            HookStep::Waiting => {
                if started.elapsed() > BUDGET {
                    anyhow::bail!("the hook did not produce a texture within {BUDGET:?}");
                }
                std::thread::sleep(Duration::from_millis(25));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamps_rebase_onto_the_first_frame() {
        let epoch = 1_000_000i64;
        assert_eq!(rebase_pts(epoch, epoch), 0);
        assert_eq!(rebase_pts(epoch + 10_000_000, epoch), TIME_BASE_DEN as i64);
    }

    #[test]
    fn a_timestamp_before_the_epoch_does_not_wrap() {
        assert_eq!(rebase_pts(0, 1_000_000), -9_000);
    }
}
