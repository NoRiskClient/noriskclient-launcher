use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::Result;

use super::Engine;
use crate::buffer::{AudioRing, PeakRing};
use crate::encoder::video::TIME_BASE_DEN;

pub(super) struct AudioPlan {
    sources: Vec<PlannedSource>,
}

struct PlannedSource {
    source: crate::audio::wasapi::AudioSource,
    track: crate::audio::Track,
    gain: f32,
}

impl AudioPlan {
    fn single(source: crate::audio::wasapi::AudioSource, gain: f32) -> Self {
        Self {
            sources: vec![PlannedSource {
                source,
                track: crate::audio::Track::Game,
                gain,
            }],
        }
    }

    fn push(
        &mut self,
        source: crate::audio::wasapi::AudioSource,
        track: crate::audio::Track,
        gain: f32,
    ) {
        self.sources.push(PlannedSource {
            source,
            track,
            gain,
        });
    }
}

fn gain(percent: u32) -> f32 {
    (percent.min(200) as f32) / 100.0
}

#[derive(Clone)]
pub(super) struct AudioStem {
    label: &'static str,
    ring: Arc<Mutex<AudioRing>>,
    extradata: Arc<Mutex<Vec<u8>>>,
    peaks: Arc<Mutex<PeakRing>>,
}

pub(super) struct AudioPipeline {
    _captures: Vec<crate::audio::LoopbackCapture>,
    pub(super) master: AudioStem,
    pub(super) stems: Vec<AudioStem>,
    pub(super) sample_rate: u32,
    pub(super) channels: u32,
    mixers: Vec<(crate::audio::Mixer, AudioSink)>,
}

type AudioSink = Arc<Mutex<dyn FnMut(&[f32], i64) + Send>>;

impl AudioPipeline {
    fn tracks(&self) -> impl Iterator<Item = &AudioStem> {
        std::iter::once(&self.master).chain(self.stems.iter())
    }

    pub(super) fn drain_mixer(&self) {
        for (mixer, sink) in &self.mixers {
            let tail = mixer.flush();
            if tail.is_empty() {
                continue;
            }

            let samples: usize = tail.iter().map(|block| block.samples.len()).sum();
            let mut sink = sink.lock().unwrap_or_else(|e| e.into_inner());
            for block in tail {
                (*sink)(&block.samples, block.timestamp_100ns);
            }
            drop(sink);

            log::debug!(
                "Drained {:.0} ms of held audio out of a mixer",
                mixer.span_100ns(samples) as f64 / 10_000.0
            );
        }

        for stem in self.tracks() {
            stem.peaks.lock().unwrap_or_else(|e| e.into_inner()).flush();
        }
    }
}

impl Engine {
    pub(super) fn system_source(
        &self,
        device: crate::audio::wasapi::AudioSource,
    ) -> crate::audio::wasapi::AudioSource {
        use crate::audio::wasapi::AudioSource;

        let Some(executable) = self
            .config
            .excluded_audio_executable
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
        else {
            return device;
        };

        if self.config.audio_device_id.as_deref().is_some_and(|id| !id.is_empty()) {
            log::warn!(
                "{executable} cannot be kept out of the clip while a specific audio device is chosen; recording the device as it is"
            );
            return device;
        }

        match crate::audio::wasapi::pid_of_executable(executable) {
            Some(pid) => {
                log::info!("Keeping {executable} (pid {pid}) out of the clip's audio");
                AudioSource::EverythingExcept(pid)
            }
            None => {
                log::info!("{executable} is not running, so there is nothing to keep out");
                device
            }
        }
    }

    pub(super) fn audio_plan(&self, pid: u32) -> AudioPlan {
        use crate::audio::wasapi::AudioSource;
        use crate::audio::Track;
        use norisk_ipc::AudioSourceChoice;

        let device = match self.config.audio_device_id.as_deref() {
            Some(id) if !id.is_empty() => AudioSource::Device(id.to_string()),
            _ => AudioSource::DefaultDevice,
        };

        let choice = if pid == 0 {
            AudioSourceChoice::System
        } else {
            self.config.audio_source
        };
        let mut plan = match choice {
            AudioSourceChoice::System => {
                AudioPlan::single(self.system_source(device), gain(self.config.other_volume))
            }
            AudioSourceChoice::GameOnly => {
                AudioPlan::single(AudioSource::Process(pid), gain(self.config.game_volume))
            }
            AudioSourceChoice::Both => {
                let mut plan = AudioPlan::single(
                    AudioSource::Process(pid),
                    gain(self.config.game_volume),
                );
                plan.push(
                    AudioSource::EverythingExcept(pid),
                    Track::Other,
                    gain(self.config.other_volume),
                );
                plan
            }
        };

        if self.config.capture_microphone {
            let device = self
                .config
                .microphone_device_id
                .as_deref()
                .filter(|id| !id.is_empty())
                .map(|id| id.to_string());

            plan.push(
                AudioSource::Microphone(device),
                Track::Microphone,
                gain(self.config.microphone_volume),
            );
        }

        plan
    }
}

enum Destination {
    Direct { sink: AudioSink, gain: f32 },
    Mixed {
        mixer: crate::audio::Mixer,
        track: crate::audio::Track,
        sink: AudioSink,
        gain: f32,
    },
}

impl Destination {
    fn accept(&self, samples: &[f32], relative: i64, scratch: &mut Vec<f32>) {
        match self {
            Destination::Direct { sink, gain } => {
                let mut sink = sink.lock().unwrap_or_else(|e| e.into_inner());
                if (gain - 1.0).abs() < f32::EPSILON {
                    (*sink)(samples, relative);
                } else {
                    crate::audio::mix::apply_gain(samples, *gain, scratch);
                    (*sink)(scratch, relative);
                }
            }
            Destination::Mixed {
                mixer,
                track,
                sink,
                gain,
            } => {
                for block in mixer.push(*track, samples, relative, *gain) {
                    let mut sink = sink.lock().unwrap_or_else(|e| e.into_inner());
                    (*sink)(&block.samples, block.timestamp_100ns);
                }
            }
        }
    }
}

fn open_stem(
    label: &'static str,
    window_seconds: f32,
    format: crate::audio::AudioFormat,
) -> Result<(AudioStem, AudioSink)> {
    use crate::audio::{encoder::DEFAULT_BITRATE, AudioEncoder};

    let mut encoder = AudioEncoder::open(format, DEFAULT_BITRATE)?;

    let header = encoder.extradata();
    if header.is_empty() {
        anyhow::bail!("the AAC encoder produced no header for the {label} track, which would leave it undecodable");
    }

    let stem = AudioStem {
        label,
        ring: Arc::new(Mutex::new(AudioRing::new(
            window_seconds,
            TIME_BASE_DEN as i64,
        ))),
        extradata: Arc::new(Mutex::new(header)),
        peaks: Arc::new(Mutex::new(PeakRing::new(
            window_seconds,
            TIME_BASE_DEN as i64,
            format.sample_rate,
            format.channels,
        ))),
    };

    let ring = Arc::clone(&stem.ring);
    let peaks = Arc::clone(&stem.peaks);

    let sink: AudioSink = Arc::new(Mutex::new(move |samples: &[f32], relative: i64| {
        peaks
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(samples, relative);

        match encoder.push(samples, relative) {
            Ok(packets) if !packets.is_empty() => {
                let mut ring = ring.lock().unwrap_or_else(|e| e.into_inner());
                for packet in packets {
                    ring.push(packet);
                }
            }
            Ok(_) => {}
            Err(e) => log::warn!("Encoding the {label} track failed: {e:#}"),
        }
    }));

    Ok((stem, sink))
}

#[derive(Clone)]
pub(super) struct AudioSelection {
    master: AudioStem,
    stems: Vec<AudioStem>,
    sample_rate: u32,
    channels: u32,
}

impl From<&AudioPipeline> for AudioSelection {
    fn from(pipeline: &AudioPipeline) -> Self {
        Self {
            master: pipeline.master.clone(),
            stems: pipeline.stems.clone(),
            sample_rate: pipeline.sample_rate,
            channels: pipeline.channels,
        }
    }
}

impl AudioSelection {
    fn tracks(&self) -> impl Iterator<Item = &AudioStem> {
        std::iter::once(&self.master).chain(self.stems.iter())
    }

    pub(super) fn cut(
        &self,
        clip: &crate::buffer::Clip,
    ) -> (Vec<crate::writer::AudioTrack>, Vec<norisk_ipc::ClipAudioTrack>) {
        let mut written = Vec::new();
        let mut described = Vec::new();

        for stem in self.tracks() {
            let packets = {
                let ring = stem.ring.lock().unwrap_or_else(|e| e.into_inner());
                log::debug!(
                    "Clip range {}..{} ticks; the {} ring holds {} packets over {:.1}s",
                    clip.start_pts,
                    clip.end_pts,
                    stem.label,
                    ring.len(),
                    ring.duration_seconds()
                );
                ring.extract(clip.start_pts, clip.end_pts)
            };

            if packets.is_empty() {
                log::warn!("Nothing on the {} track covered the clip", stem.label);
                continue;
            }

            let extradata = stem
                .extradata
                .lock()
                .map(|header| header.clone())
                .unwrap_or_default();
            if extradata.is_empty() {
                log::warn!("The {} track has no codec header; leaving it out", stem.label);
                continue;
            }

            let peaks = {
                let ring = stem.peaks.lock().unwrap_or_else(|e| e.into_inner());
                dense_peaks(&ring.extract(clip.playback_start_pts, clip.end_pts), clip)
            };

            described.push(norisk_ipc::ClipAudioTrack {
                label: stem.label.to_string(),
                stream: written.len() as u32,
                adjustable: stem.label != crate::audio::MIX_LABEL,
                peaks,
            });

            written.push(crate::writer::AudioTrack {
                sample_rate: self.sample_rate,
                channels: self.channels,
                extradata,
                packets,
                label: stem.label.to_string(),
            });
        }

        (written, described)
    }
}

fn dense_peaks(points: &[crate::buffer::Peak], clip: &crate::buffer::Clip) -> Vec<u8> {
    let step = (norisk_ipc::PEAK_STEP_MS as i64 * TIME_BASE_DEN as i64 / 1_000).max(1);
    let from = clip.playback_start_pts;
    let span = (clip.end_pts - from).max(0);

    let slots = ((span / step) + 1).clamp(0, 60 * 60 * 1_000 / norisk_ipc::PEAK_STEP_MS as i64)
        as usize;

    let mut out = vec![0u8; slots];
    for point in points {
        let slot = ((point.pts - from) / step).max(0) as usize;
        if let Some(cell) = out.get_mut(slot) {
            *cell = (*cell).max(point.value);
        }
    }
    out
}

pub(super) fn start_audio(
    window_seconds: f32,
    plan: AudioPlan,
    epoch: Arc<AtomicI64>,
    denoise_microphone: bool,
) -> Result<AudioPipeline> {
    use crate::audio::{LoopbackCapture, Mixer, Track};

    if plan.sources.is_empty() {
        anyhow::bail!("no audio source to record");
    }

    let (primary, format) = crate::audio::wasapi::probe_source(&plan.sources[0].source)?;

    let (master, master_sink) = open_stem(crate::audio::MIX_LABEL, window_seconds, format)?;

    let mut mixers: Vec<(Mixer, AudioSink)> = Vec::new();

    let master_mixer = if plan.sources.len() > 1 {
        let tracks: Vec<Track> = plan.sources.iter().map(|source| source.track).collect();
        let mixer = Mixer::new(format.sample_rate, format.channels, &tracks);
        mixers.push((mixer.clone(), Arc::clone(&master_sink)));
        Some(mixer)
    } else {
        None
    };

    let has_microphone = plan
        .sources
        .iter()
        .any(|source| source.track == Track::Microphone);
    let game_sources = plan
        .sources
        .iter()
        .filter(|source| source.track != Track::Microphone)
        .count();

    let microphone_format = plan
        .sources
        .iter()
        .find(|source| source.track == Track::Microphone)
        .and_then(|source| crate::audio::wasapi::probe_source(&source.source).ok())
        .map(|(_, format)| format)
        .unwrap_or(format);

    let denoise_microphone =
        denoise_microphone && crate::audio::denoise::works_at(microphone_format.sample_rate);

    let mut stems = Vec::new();
    let mut game_stem: Option<(Option<Mixer>, AudioSink)> = None;
    let mut microphone_stem: Option<AudioSink> = None;

    if has_microphone && game_sources > 0 {
        let (stem, sink) = open_stem(crate::audio::GAME_LABEL, window_seconds, format)?;
        let mixer = if game_sources > 1 {
            let tracks: Vec<Track> = plan
                .sources
                .iter()
                .map(|source| source.track)
                .filter(|track| *track != Track::Microphone)
                .collect();
            let mixer = Mixer::new(format.sample_rate, format.channels, &tracks);
            mixers.push((mixer.clone(), Arc::clone(&sink)));
            Some(mixer)
        } else {
            None
        };
        stems.push(stem);
        game_stem = Some((mixer, sink));

        let (stem, sink) = open_stem(crate::audio::MIC_LABEL, window_seconds, microphone_format)?;
        stems.push(stem);
        microphone_stem = Some(sink);
    }

    fn rebase(epoch: &AtomicI64, timestamp: i64) -> i64 {
        let _ = epoch.compare_exchange(i64::MIN, timestamp, Ordering::Relaxed, Ordering::Relaxed);
        timestamp
            .saturating_sub(epoch.load(Ordering::Relaxed))
            .max(0)
    }

    let mut captures = Vec::new();

    for (index, planned) in plan.sources.into_iter().enumerate() {
        let source = if index == 0 {
            primary.clone()
        } else {
            planned.source
        };
        let track = planned.track;
        let gain = planned.gain;

        let mut destinations = vec![match master_mixer.as_ref() {
            Some(mixer) => Destination::Mixed {
                mixer: mixer.clone(),
                track,
                sink: Arc::clone(&master_sink),
                gain,
            },
            None => Destination::Direct {
                sink: Arc::clone(&master_sink),
                gain,
            },
        }];

        if track == Track::Microphone {
            if let Some(sink) = microphone_stem.as_ref() {
                destinations.push(Destination::Direct {
                    sink: Arc::clone(sink),
                    gain,
                });
            }
        } else if let Some((mixer, sink)) = game_stem.as_ref() {
            destinations.push(match mixer {
                Some(mixer) => Destination::Mixed {
                    mixer: mixer.clone(),
                    track,
                    sink: Arc::clone(sink),
                    gain,
                },
                None => Destination::Direct {
                    sink: Arc::clone(sink),
                    gain,
                },
            });
        }

        let epoch = Arc::clone(&epoch);
        let mut scratch = Vec::new();

        let mut denoiser = (denoise_microphone && track == Track::Microphone)
            .then(|| crate::audio::denoise::Denoiser::new(microphone_format.channels));
        let mut cleaned: Vec<f32> = Vec::new();

        captures.push(LoopbackCapture::start_from(
            source,
            move |samples: &[f32], timestamp: i64| {
                let relative = rebase(&epoch, timestamp);
                let samples = match denoiser.as_mut() {
                    Some(denoiser) => {
                        cleaned.clear();
                        cleaned.extend_from_slice(samples);
                        denoiser.process(&mut cleaned);
                        cleaned.as_slice()
                    }
                    None => samples,
                };
                for destination in &destinations {
                    destination.accept(samples, relative, &mut scratch);
                }
            },
        )?);

        if denoise_microphone && track == Track::Microphone {
            log::info!(
                "Recording {track:?} audio at {:.0}% with noise suppression",
                gain * 100.0
            );
        } else {
            log::info!("Recording {track:?} audio at {:.0}%", gain * 100.0);
        }
    }

    log::info!(
        "Desktop audio attached: {} source(s), {} Hz {}ch, written as {} track(s)",
        captures.len(),
        format.sample_rate,
        format.channels,
        1 + stems.len()
    );

    Ok(AudioPipeline {
        _captures: captures,
        master,
        stems,
        sample_rate: crate::audio::encoder::OUTPUT_SAMPLE_RATE as u32,
        channels: crate::audio::encoder::OUTPUT_CHANNELS as u32,
        mixers,
    })
}
