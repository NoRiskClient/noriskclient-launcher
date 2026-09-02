use std::path::PathBuf;

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 1;

pub fn pipe_name(session_id: &str) -> String {
    format!(r"\\.\pipe\norisk-capture-{session_id}")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LauncherToCapture {
    Configure(CaptureConfig),
    AttachWindow { pid: u32 },
    DetachWindow,
    SaveClip(SaveClipRequest),
    TrimClip(TrimClipRequest),
    ExportVertical(ExportVerticalRequest),
    PrepareAudioPreview(AudioPreviewRequest),
    SetBufferEnabled { enabled: bool },
    Ping { seq: u64 },
    Shutdown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CaptureConfig {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate_kbps: u32,
    pub buffer_seconds: u32,
    pub gop_seconds: f32,
    #[serde(default)]
    pub codec: ClipCodec,
    pub encoder: EncoderPreference,
    pub capture_audio: bool,
    #[serde(default)]
    pub audio_source: AudioSourceChoice,
    #[serde(default)]
    pub audio_device_id: Option<String>,
    #[serde(default = "default_volume")]
    pub game_volume: u32,
    #[serde(default = "default_volume")]
    pub other_volume: u32,
    #[serde(default)]
    pub capture_microphone: bool,
    #[serde(default)]
    pub microphone_device_id: Option<String>,
    #[serde(default = "default_volume")]
    pub microphone_volume: u32,
    pub output_dir: PathBuf,
}

fn default_volume() -> u32 {
    100
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AudioSourceChoice {
    #[default]
    System,
    GameOnly,
    Both,
}

impl Default for CaptureConfig {
    fn default() -> Self {
        Self {
            width: 1920,
            height: 1080,
            fps: 60,
            bitrate_kbps: 20_000,
            buffer_seconds: 30,
            gop_seconds: 2.0,
            codec: ClipCodec::H264,
            encoder: EncoderPreference::Auto,
            capture_audio: true,
            audio_source: AudioSourceChoice::System,
            audio_device_id: None,
            game_volume: default_volume(),
            other_volume: default_volume(),
            capture_microphone: false,
            microphone_device_id: None,
            microphone_volume: default_volume(),
            output_dir: PathBuf::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EncoderPreference {
    Auto,
    Nvenc,
    Amf,
    QuickSync,
    Software,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum ClipCodec {
    #[default]
    H264,
    H265,
    Av1,
}

impl ClipCodec {
    pub fn all() -> [ClipCodec; 3] {
        [ClipCodec::H264, ClipCodec::H265, ClipCodec::Av1]
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EncoderCapability {
    pub codec: ClipCodec,
    pub encoder: EncoderPreference,
    pub available: bool,
    pub hardware: bool,
    pub detail: Option<String>,
}

impl EncoderPreference {
    pub fn resolve(self, available: &[EncoderPreference]) -> Option<EncoderPreference> {
        match self {
            _ if available.is_empty() => None,
            EncoderPreference::Auto => available.first().copied(),
            explicit if available.contains(&explicit) => Some(explicit),
            _ => available.first().copied(),
        }
    }
}

pub fn select_encoder(
    codec: ClipCodec,
    preference: EncoderPreference,
    capabilities: &[EncoderCapability],
) -> Option<(ClipCodec, EncoderPreference)> {
    let mut codecs: Vec<ClipCodec> = Vec::new();
    for candidate in std::iter::once(codec)
        .chain(std::iter::once(ClipCodec::H264))
        .chain(ClipCodec::all())
    {
        if !codecs.contains(&candidate) {
            codecs.push(candidate);
        }
    }

    let passes: &[bool] = if preference == EncoderPreference::Software {
        &[false]
    } else {
        &[true, false]
    };

    for &hardware_only in passes {
        for &candidate in &codecs {
            let available: Vec<EncoderPreference> = capabilities
                .iter()
                .filter(|c| c.codec == candidate && c.available)
                .filter(|c| c.hardware || !hardware_only)
                .map(|c| c.encoder)
                .collect();

            if let Some(encoder) = preference.resolve(&available) {
                return Some((candidate, encoder));
            }
        }
    }

    None
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveClipRequest {
    pub pre_roll_seconds: u32,
    pub post_roll_seconds: u32,
    pub reason: ClipReason,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum ClipReason {
    Manual,
    Event(String),
}

impl ClipReason {
    pub fn slug(&self) -> String {
        match self {
            ClipReason::Manual => "clip".to_string(),
            ClipReason::Event(kind) => kind
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '_' })
                .collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CaptureToLauncher {
    Ready(ReadyInfo),
    Status(StatusReport),
    ClipSaved(ClipManifest),
    ClipTrimmed(TrimmedClip),
    ClipExported(ExportedClip),
    ExportProgress(ExportProgress),
    AudioPreviewReady(AudioPreview),
    Error(CaptureError),
    Pong { seq: u64 },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReadyInfo {
    pub protocol_version: u32,
    pub engine_version: String,
    pub available_encoders: Vec<EncoderPreference>,
    #[serde(default)]
    pub capabilities: Vec<EncoderCapability>,
    pub adapter: String,
    #[serde(default)]
    pub audio_devices: Vec<AudioDeviceInfo>,
    #[serde(default)]
    pub microphones: Vec<AudioDeviceInfo>,
    #[serde(default)]
    pub supports_game_only_audio: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptureState {
    Idle,
    Attaching,
    Buffering,
    Paused,
    BlockedFullscreenExclusive,
    Failed,
}

impl CaptureState {
    pub fn can_save(&self) -> bool {
        matches!(self, CaptureState::Buffering)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StatusReport {
    pub state: CaptureState,
    pub buffer_fill_seconds: f32,
    pub buffer_bytes: u64,
    pub capture_fps: f32,
    pub encode_fps: f32,
    pub dropped_frames: u64,
    pub encode_latency_ms_p99: f32,
    #[serde(default)]
    pub capture_method: Option<String>,
    #[serde(default)]
    pub active_codec: Option<ClipCodec>,
    #[serde(default)]
    pub active_encoder: Option<EncoderPreference>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClipManifest {
    pub path: PathBuf,
    pub thumbnail: Option<PathBuf>,
    pub duration_seconds: f32,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate_kbps: u32,
    pub size_bytes: u64,
    pub reason: ClipReason,
    pub created_at: String,
    #[serde(default)]
    pub audio_tracks: Vec<ClipAudioTrack>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClipAudioTrack {
    pub label: String,
    pub stream: u32,
    pub adjustable: bool,
    pub peaks: Vec<u8>,
}

pub const PEAK_STEP_MS: u32 = 20;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CaptureError {
    pub code: ErrorCode,
    pub message: String,
    pub recoverable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    WindowNotFound,
    EncoderUnavailable,
    GraphicsDevice,
    AudioDevice,
    ClipWrite,
    BufferEmpty,
    Internal,
}

pub fn encode_line<T: Serialize>(message: &T) -> serde_json::Result<String> {
    let mut line = serde_json::to_string(message)?;
    line.push('\n');
    Ok(line)
}

pub fn decode_line<T: serde::de::DeserializeOwned>(line: &str) -> serde_json::Result<T> {
    serde_json::from_str(line.trim_end_matches(['\r', '\n']))
}

#[cfg(test)]
mod selection_tests {
    use super::*;

    fn cap(
        codec: ClipCodec,
        encoder: EncoderPreference,
        hardware: bool,
        available: bool,
    ) -> EncoderCapability {
        EncoderCapability {
            codec,
            encoder,
            available,
            hardware,
            detail: None,
        }
    }

    fn machine(usable: &[(ClipCodec, EncoderPreference)]) -> Vec<EncoderCapability> {
        let mut matrix = Vec::new();
        for codec in ClipCodec::all() {
            for (encoder, hardware) in [
                (EncoderPreference::Nvenc, true),
                (EncoderPreference::Amf, true),
                (EncoderPreference::QuickSync, true),
                (EncoderPreference::Software, false),
            ] {
                matrix.push(cap(
                    codec,
                    encoder,
                    hardware,
                    usable.contains(&(codec, encoder)),
                ));
            }
        }
        matrix
    }

    fn modern_nvidia() -> Vec<EncoderCapability> {
        machine(&[
            (ClipCodec::H264, EncoderPreference::Nvenc),
            (ClipCodec::H264, EncoderPreference::Software),
            (ClipCodec::H265, EncoderPreference::Nvenc),
            (ClipCodec::H265, EncoderPreference::Software),
            (ClipCodec::Av1, EncoderPreference::Nvenc),
            (ClipCodec::Av1, EncoderPreference::Software),
        ])
    }

    #[test]
    fn an_available_choice_is_used_as_asked() {
        for codec in ClipCodec::all() {
            assert_eq!(
                select_encoder(codec, EncoderPreference::Nvenc, &modern_nvidia()),
                Some((codec, EncoderPreference::Nvenc)),
                "{codec:?}"
            );
        }
    }

    #[test]
    fn a_codec_the_gpu_cannot_do_falls_back_to_hardware_not_to_the_processor() {
        let older_card = machine(&[
            (ClipCodec::H264, EncoderPreference::Nvenc),
            (ClipCodec::H264, EncoderPreference::Software),
            (ClipCodec::H265, EncoderPreference::Nvenc),
            (ClipCodec::H265, EncoderPreference::Software),
            (ClipCodec::Av1, EncoderPreference::Software),
        ]);

        assert_eq!(
            select_encoder(ClipCodec::Av1, EncoderPreference::Auto, &older_card),
            Some((ClipCodec::H264, EncoderPreference::Nvenc))
        );
    }

    #[test]
    fn the_hardware_fallback_prefers_h264() {
        let card = machine(&[
            (ClipCodec::H264, EncoderPreference::Amf),
            (ClipCodec::H265, EncoderPreference::Amf),
        ]);

        assert_eq!(
            select_encoder(ClipCodec::Av1, EncoderPreference::Auto, &card),
            Some((ClipCodec::H264, EncoderPreference::Amf)),
        );
    }

    #[test]
    fn a_machine_without_hardware_still_records() {
        let cpu_only = machine(&[
            (ClipCodec::H264, EncoderPreference::Software),
            (ClipCodec::H265, EncoderPreference::Software),
        ]);

        assert_eq!(
            select_encoder(ClipCodec::H265, EncoderPreference::Auto, &cpu_only),
            Some((ClipCodec::H265, EncoderPreference::Software))
        );
    }

    #[test]
    fn an_explicit_processor_choice_is_honoured_over_hardware() {
        assert_eq!(
            select_encoder(ClipCodec::H265, EncoderPreference::Software, &modern_nvidia()),
            Some((ClipCodec::H265, EncoderPreference::Software))
        );
    }

    #[test]
    fn a_vendor_that_is_not_present_falls_back_within_the_codec() {
        assert_eq!(
            select_encoder(ClipCodec::H264, EncoderPreference::Amf, &modern_nvidia()),
            Some((ClipCodec::H264, EncoderPreference::Nvenc))
        );
    }

    #[test]
    fn a_machine_that_can_encode_nothing_selects_nothing() {
        assert_eq!(
            select_encoder(ClipCodec::H264, EncoderPreference::Auto, &machine(&[])),
            None
        );
        assert_eq!(select_encoder(ClipCodec::H264, EncoderPreference::Auto, &[]), None);
    }

    #[test]
    fn an_impossible_processor_request_still_records() {
        let gpu_only = machine(&[(ClipCodec::H264, EncoderPreference::Nvenc)]);

        assert_eq!(
            select_encoder(ClipCodec::H264, EncoderPreference::Software, &gpu_only),
            Some((ClipCodec::H264, EncoderPreference::Nvenc))
        );
    }
}

#[cfg(test)]
mod export_progress {
    use super::*;

    fn at(done: u32, total: u32) -> ExportProgress {
        ExportProgress {
            source: PathBuf::from("clip.mp4"),
            done,
            total,
        }
    }

    #[test]
    fn a_fresh_export_is_at_nothing() {
        assert_eq!(at(0, 900).fraction(), 0.0);
    }

    #[test]
    fn halfway_is_a_half() {
        assert_eq!(at(450, 900).fraction(), 0.5);
    }

    #[test]
    fn finished_is_one() {
        assert_eq!(at(900, 900).fraction(), 1.0);
    }

    #[test]
    fn a_clip_with_no_frames_counts_as_done() {
        assert_eq!(at(0, 0).fraction(), 1.0);
    }

    #[test]
    fn a_count_past_the_end_does_not_overshoot() {
        assert_eq!(at(1000, 900).fraction(), 1.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_command() {
        let msg = LauncherToCapture::SaveClip(SaveClipRequest {
            pre_roll_seconds: 20,
            post_roll_seconds: 10,
            reason: ClipReason::Event("PLAYER_KILL".into()),
        });

        let line = encode_line(&msg).unwrap();
        assert!(line.ends_with('\n'));
        assert_eq!(line.matches('\n').count(), 1, "framing must stay one line");

        let back: LauncherToCapture = decode_line(&line).unwrap();
        assert_eq!(back, msg);
    }

    #[test]
    fn round_trips_a_report() {
        let msg = CaptureToLauncher::Status(StatusReport {
            state: CaptureState::BlockedFullscreenExclusive,
            buffer_fill_seconds: 0.0,
            buffer_bytes: 0,
            capture_fps: 0.0,
            encode_fps: 0.0,
            dropped_frames: 0,
            encode_latency_ms_p99: 0.0,
            capture_method: Some("graphics hook".to_string()),
            active_codec: Some(ClipCodec::Av1),
            active_encoder: Some(EncoderPreference::Nvenc),
        });

        let back: CaptureToLauncher = decode_line(&encode_line(&msg).unwrap()).unwrap();
        assert_eq!(back, msg);
    }

    #[test]
    fn a_report_without_the_active_pairing_still_parses() {
        let line = r#"{"type":"status","state":"buffering","buffer_fill_seconds":1.0,"buffer_bytes":10,"capture_fps":60.0,"encode_fps":60.0,"dropped_frames":0,"encode_latency_ms_p99":0.0}"#;

        let CaptureToLauncher::Status(report) = decode_line(line).expect("parses") else {
            panic!("not a status report");
        };
        assert_eq!(report.active_codec, None);
        assert_eq!(report.active_encoder, None);
    }

    #[test]
    fn tolerates_crlf_and_missing_newline() {
        let raw = serde_json::to_string(&LauncherToCapture::DetachWindow).unwrap();
        let bare: LauncherToCapture = decode_line(&raw).unwrap();
        let crlf: LauncherToCapture = decode_line(&format!("{raw}\r\n")).unwrap();
        assert_eq!(bare, LauncherToCapture::DetachWindow);
        assert_eq!(crlf, LauncherToCapture::DetachWindow);
    }

    #[test]
    fn strings_with_newlines_stay_on_one_line() {
        let msg = CaptureToLauncher::Error(CaptureError {
            code: ErrorCode::Internal,
            message: "line one\nline two".into(),
            recoverable: true,
        });

        let line = encode_line(&msg).unwrap();
        assert_eq!(line.matches('\n').count(), 1);

        let back: CaptureToLauncher = decode_line(&line).unwrap();
        assert_eq!(back, msg);
    }

    #[test]
    fn clip_reason_produces_a_filename_safe_slug() {
        assert_eq!(ClipReason::Manual.slug(), "clip");
        assert_eq!(ClipReason::Event("PLAYER_KILL".into()).slug(), "player_kill");
        assert_eq!(ClipReason::Event("bed/destroy!".into()).slug(), "bed_destroy_");
    }

    #[test]
    fn auto_takes_the_best_available() {
        let available = [EncoderPreference::Amf, EncoderPreference::Software];
        assert_eq!(
            EncoderPreference::Auto.resolve(&available),
            Some(EncoderPreference::Amf)
        );
    }

    #[test]
    fn an_explicit_choice_is_honoured_when_usable() {
        let available = [EncoderPreference::Nvenc, EncoderPreference::Software];
        assert_eq!(
            EncoderPreference::Software.resolve(&available),
            Some(EncoderPreference::Software)
        );
    }

    #[test]
    fn an_unusable_choice_falls_back_instead_of_failing() {
        let available = [EncoderPreference::Amf];
        assert_eq!(
            EncoderPreference::Nvenc.resolve(&available),
            Some(EncoderPreference::Amf)
        );
    }

    #[test]
    fn nothing_available_resolves_to_nothing() {
        assert_eq!(EncoderPreference::Auto.resolve(&[]), None);
        assert_eq!(EncoderPreference::Nvenc.resolve(&[]), None);
    }

    #[test]
    fn only_buffering_allows_saving() {
        assert!(CaptureState::Buffering.can_save());
        assert!(!CaptureState::BlockedFullscreenExclusive.can_save());
        assert!(!CaptureState::Idle.can_save());
        assert!(!CaptureState::Paused.can_save());
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrimClipRequest {
    pub source: PathBuf,
    pub destination: PathBuf,
    pub start_seconds: f64,
    pub end_seconds: f64,
    #[serde(default)]
    pub levels: Vec<TrackLevel>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrackLevel {
    pub stream: u32,
    pub volume: u32,
}

impl TrackLevel {
    pub fn gain(&self) -> f32 {
        self.volume.min(200) as f32 / 100.0
    }
}

pub fn levels_change_anything(levels: &[TrackLevel]) -> bool {
    levels.iter().any(|level| level.volume != 100)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AudioPreviewRequest {
    pub source: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AudioPreview {
    pub source: PathBuf,
    pub tracks: Vec<PreviewTrack>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewTrack {
    pub stream: u32,
    pub label: String,
    pub path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExportVerticalRequest {
    pub source: PathBuf,
    pub destination: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    pub source: PathBuf,
    pub done: u32,
    pub total: u32,
}

impl ExportProgress {
    pub fn fraction(&self) -> f32 {
        if self.total == 0 {
            return 1.0;
        }
        (self.done as f32 / self.total as f32).clamp(0.0, 1.0)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExportedClip {
    pub path: PathBuf,
    pub source: PathBuf,
    pub width: u32,
    pub height: u32,
    pub duration_seconds: f64,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrimmedClip {
    pub path: PathBuf,
    pub source: PathBuf,
    pub duration_seconds: f64,
    pub size_bytes: u64,
    pub start_seconds: f64,
    pub end_seconds: f64,
}
