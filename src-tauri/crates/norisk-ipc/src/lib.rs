use std::path::PathBuf;

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 5;

pub fn pipe_name(session_id: &str) -> String {
    format!(r"\\.\pipe\norisk-capture-{session_id}")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LauncherToCapture {
    Configure(CaptureConfig),
    AttachWindow { pid: u32 },
    AttachScreen { device: String },
    DetachWindow,
    SaveClip(SaveClipRequest),
    TrimClip(TrimClipRequest),
    ExportVertical(ExportVerticalRequest),
    ExportGif(ExportGifRequest),
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
    #[serde(default)]
    pub microphone_denoise: bool,
    #[serde(default)]
    pub excluded_audio_executable: Option<String>,
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
            microphone_denoise: false,
            excluded_audio_executable: None,
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
    VideoToolbox,
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
    #[serde(default)]
    pub driver_too_old: bool,
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
        let order: Vec<ClipCodec> = if !hardware_only && preference != EncoderPreference::Software {
            std::iter::once(ClipCodec::H264)
                .chain(codecs.iter().copied().filter(|&c| c != ClipCodec::H264))
                .collect()
        } else {
            codecs.clone()
        };
        for &candidate in &order {
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
    GifExported(ExportedGif),
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
    #[serde(default)]
    pub gpu_driver: Option<String>,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CaptureMethod {
    #[serde(rename = "graphics hook")]
    GraphicsHook,
    #[serde(rename = "window capture")]
    WindowCapture,
    #[serde(rename = "screen capture")]
    ScreenCapture,
    #[serde(rename = "screencapturekit")]
    ScreenCaptureKit,
    #[serde(rename = "unknown", other)]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StatusReport {
    pub state: CaptureState,
    pub buffer_fill_seconds: f32,
    pub buffer_bytes: u64,
    pub capture_fps: f32,
    pub encode_fps: f32,
    pub dropped_frames: u64,
    #[serde(default)]
    pub dropped_before_keyframe: u64,
    pub encode_latency_ms_p99: f32,
    #[serde(default)]
    pub capture_method: Option<CaptureMethod>,
    #[serde(default)]
    pub retry_in_seconds: Option<u32>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<PathBuf>,
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
    NotRecording,
    Paused,
    Internal,
    Protocol,
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
            driver_too_old: false,
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
    fn a_machine_without_hardware_records_h264_on_the_processor_because_it_is_the_lightest() {
        let cpu_only = machine(&[
            (ClipCodec::H264, EncoderPreference::Software),
            (ClipCodec::H265, EncoderPreference::Software),
        ]);

        assert_eq!(
            select_encoder(ClipCodec::H265, EncoderPreference::Auto, &cpu_only),
            Some((ClipCodec::H264, EncoderPreference::Software))
        );
    }

    #[test]
    fn a_machine_without_hardware_or_h264_still_records_what_it_can() {
        let cpu_only = machine(&[(ClipCodec::H265, EncoderPreference::Software)]);

        assert_eq!(
            select_encoder(ClipCodec::Av1, EncoderPreference::Auto, &cpu_only),
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
    fn progress_runs_from_nothing_to_one_and_an_empty_clip_counts_as_done() {
        assert_eq!(at(0, 900).fraction(), 0.0);
        assert_eq!(at(450, 900).fraction(), 0.5);
        assert_eq!(at(900, 900).fraction(), 1.0);
        assert_eq!(at(1000, 900).fraction(), 1.0);
        assert_eq!(at(0, 0).fraction(), 1.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_methods_keep_the_text_older_launchers_and_analytics_know() {
        let text = |method| serde_json::to_string(&method).unwrap();
        assert_eq!(text(CaptureMethod::GraphicsHook), r#""graphics hook""#);
        assert_eq!(text(CaptureMethod::WindowCapture), r#""window capture""#);
        assert_eq!(text(CaptureMethod::ScreenCapture), r#""screen capture""#);
        assert_eq!(text(CaptureMethod::ScreenCaptureKit), r#""screencapturekit""#);

        let read = |raw: &str| serde_json::from_str::<CaptureMethod>(raw).unwrap();
        assert_eq!(read(r#""graphics hook""#), CaptureMethod::GraphicsHook);
        assert_eq!(read(r#""window capture""#), CaptureMethod::WindowCapture);
        assert_eq!(read(r#""screen capture""#), CaptureMethod::ScreenCapture);
        assert_eq!(read(r#""screencapturekit""#), CaptureMethod::ScreenCaptureKit);
        assert_eq!(read(r#""some future method""#), CaptureMethod::Unknown);
    }

    #[test]
    fn a_report_from_a_newer_engine_with_an_unknown_capture_method_still_parses() {
        let line = r#"{"type":"status","state":"buffering","buffer_fill_seconds":1.0,"buffer_bytes":10,"capture_fps":60.0,"encode_fps":60.0,"dropped_frames":0,"encode_latency_ms_p99":0.0,"capture_method":"desktop duplication"}"#;

        let CaptureToLauncher::Status(report) = decode_line(line).expect("parses") else {
            panic!("not a status report");
        };
        assert_eq!(report.capture_method, Some(CaptureMethod::Unknown));
    }

    #[test]
    fn edit_spans_from_a_newer_editor_with_extra_fields_still_parse() {
        let span: Span = serde_json::from_str(r#"{"startSeconds":1.0,"endSeconds":2.0,"label":"x"}"#).unwrap();
        assert_eq!(span, Span { start_seconds: 1.0, end_seconds: 2.0 });

        let cut: TrackCut =
            serde_json::from_str(r#"{"stream":1,"startSeconds":1.0,"endSeconds":2.0,"fade":true}"#).unwrap();
        assert_eq!(cut, TrackCut { stream: 1, start_seconds: 1.0, end_seconds: 2.0 });

        let level: TrackLevel = serde_json::from_str(r#"{"stream":2,"volume":80,"pan":0.5}"#).unwrap();
        assert_eq!((level.stream, level.volume), (2, 80));
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
            source: None,
        });

        let line = encode_line(&msg).unwrap();
        assert_eq!(line.matches('\n').count(), 1);

        let back: CaptureToLauncher = decode_line(&line).unwrap();
        assert_eq!(back, msg);
    }

    #[test]
    fn an_error_names_the_clip_it_failed_on_as_a_plain_path() {
        let failed = CaptureToLauncher::Error(CaptureError {
            code: ErrorCode::ClipWrite,
            message: "disk full".into(),
            recoverable: true,
            source: Some(PathBuf::from("C:/clips/fight.mp4")),
        });

        let wire: serde_json::Value = serde_json::to_value(&failed).unwrap();
        assert_eq!(wire["source"], "C:/clips/fight.mp4");
        assert_eq!(decode_line::<CaptureToLauncher>(&encode_line(&failed).unwrap()).unwrap(), failed);
    }

    #[test]
    fn an_error_without_a_clip_leaves_the_source_off_and_older_errors_still_parse() {
        let general = CaptureToLauncher::Error(CaptureError {
            code: ErrorCode::Internal,
            message: "boom".into(),
            recoverable: true,
            source: None,
        });
        let wire: serde_json::Value = serde_json::to_value(&general).unwrap();
        assert!(wire.get("source").is_none());

        let older: CaptureToLauncher = decode_line(
            r#"{"type":"error","code":"internal","message":"boom","recoverable":true}"#,
        )
        .unwrap();
        assert_eq!(older, general);
    }

    #[test]
    fn a_level_sent_without_an_offset_still_parses_and_sits_still() {
        let level: TrackLevel = serde_json::from_str(r#"{"stream":2,"volume":80}"#).unwrap();

        assert_eq!(level.offset_seconds, 0.0);
        assert_eq!(level.offset_ticks(90_000), 0);
        assert_eq!(level.start_seconds, None);
        assert_eq!(level.end_seconds, None);
        assert_eq!(level.window_ticks(90_000, 0), (None, None));
    }

    #[test]
    fn a_level_speaks_camel_case_on_the_wire_like_the_other_requests() {
        let level: TrackLevel = serde_json::from_str(
            r#"{"stream":1,"volume":90,"offsetSeconds":0.5,"startSeconds":2.0,"endSeconds":8.0}"#,
        )
        .unwrap();
        assert_eq!(level.offset_seconds, 0.5);
        assert_eq!(level.start_seconds, Some(2.0));
        assert_eq!(level.end_seconds, Some(8.0));

        let written = serde_json::to_string(&level).unwrap();
        assert!(written.contains("\"offsetSeconds\""), "{written}");
        assert!(!written.contains("offset_seconds"), "{written}");
    }

    #[test]
    fn a_removed_stretch_reads_what_the_editor_sends_and_nothing_else() {
        let span: Span =
            serde_json::from_str(r#"{"startSeconds":2.5,"endSeconds":4.0}"#).unwrap();
        assert_eq!(span, Span { start_seconds: 2.5, end_seconds: 4.0 });

        assert!(
            serde_json::from_str::<Span>(r#"{"start_seconds":2.5,"end_seconds":4.0}"#).is_err(),
            "a stretch in the wrong spelling must fail loudly, not arrive empty",
        );
    }

    #[test]
    fn a_window_that_is_not_a_number_is_no_window_at_all() {
        let nonsense = TrackLevel {
            stream: 1,
            volume: 100,
            offset_seconds: 0.0,
            start_seconds: Some(f64::NAN),
            end_seconds: Some(f64::INFINITY),
        };

        assert!(!nonsense.has_window());
        assert!(!levels_change_anything(&[nonsense]));
        assert_eq!(nonsense.window_ticks(90_000, 0), (None, None));
    }

    #[test]
    fn clip_reason_produces_a_filename_safe_slug() {
        assert_eq!(ClipReason::Manual.slug(), "clip");
        assert_eq!(ClipReason::Event("PLAYER_KILL".into()).slug(), "player_kill");
        assert_eq!(ClipReason::Event("bed/destroy!".into()).slug(), "bed_destroy_");
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrimClipRequest {
    pub source: PathBuf,
    pub destination: PathBuf,
    pub start_seconds: f64,
    pub end_seconds: f64,
    #[serde(default)]
    pub video_start_seconds: Option<f64>,
    #[serde(default)]
    pub video_end_seconds: Option<f64>,
    #[serde(default)]
    pub levels: Vec<TrackLevel>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackLevel {
    pub stream: u32,
    pub volume: u32,
    #[serde(default)]
    pub offset_seconds: f64,
    #[serde(default)]
    pub start_seconds: Option<f64>,
    #[serde(default)]
    pub end_seconds: Option<f64>,
}

impl TrackLevel {
    pub fn gain(&self) -> f32 {
        self.volume.min(200) as f32 / 100.0
    }

    pub fn offset_ticks(&self, ticks_per_second: i64) -> i64 {
        if !self.offset_seconds.is_finite() {
            return 0;
        }
        (self.offset_seconds * ticks_per_second as f64) as i64
    }

    pub fn window_ticks(&self, ticks_per_second: i64, origin: i64) -> (Option<i64>, Option<i64>) {
        let at = |seconds: Option<f64>| {
            seconds
                .filter(|s| s.is_finite())
                .map(|s| ticks_at(origin, s, ticks_per_second))
        };
        (at(self.start_seconds), at(self.end_seconds))
    }

    pub fn has_window(&self) -> bool {
        let given = |seconds: Option<f64>| seconds.is_some_and(|s| s.is_finite());
        given(self.start_seconds) || given(self.end_seconds)
    }
}

pub fn ticks_at(origin: i64, seconds: f64, ticks_per_second: i64) -> i64 {
    origin.saturating_add((seconds * ticks_per_second as f64) as i64)
}

pub fn levels_change_anything(levels: &[TrackLevel]) -> bool {
    levels.iter().any(|level| {
        level.volume != 100
            || (level.offset_seconds.is_finite() && level.offset_seconds != 0.0)
            || level.has_window()
    })
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
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OverlayKind {
    Blur { strength: u32 },
    Box { colour: u32 },
    Arrow { colour: u32, thickness: u32, towards: Corner },
    Text {
        content: String,
        size: u32,
        colour: u32,
        #[serde(default)]
        align: TextAlign,
        #[serde(default)]
        vertical: TextVertical,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum TextAlign {
    Left,
    #[default]
    Center,
    Right,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum TextVertical {
    Top,
    #[default]
    Center,
    Bottom,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum Corner {
    TopLeft,
    TopRight,
    BottomLeft,
    #[default]
    BottomRight,
    Top,
    Right,
    Bottom,
    Left,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClipOverlay {
    #[serde(flatten)]
    pub kind: OverlayKind,
    pub left: f32,
    pub top: f32,
    pub width: f32,
    pub height: f32,
    pub start_seconds: f64,
    pub end_seconds: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ClipShape {
    #[default]
    Vertical,
    Square,
    Wide,
    Original,
}

impl ClipShape {
    pub fn ratio(self) -> Option<(i64, i64)> {
        match self {
            ClipShape::Vertical => Some((9, 16)),
            ClipShape::Square => Some((1, 1)),
            ClipShape::Wide => Some((21, 9)),
            ClipShape::Original => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ExportVerticalRequest {
    pub source: PathBuf,
    pub destination: PathBuf,
    #[serde(default)]
    pub shape: ClipShape,
    #[serde(default)]
    pub overlays: Vec<ClipOverlay>,
    #[serde(default)]
    pub start_seconds: Option<f64>,
    #[serde(default)]
    pub end_seconds: Option<f64>,
    #[serde(default)]
    pub video_start_seconds: Option<f64>,
    #[serde(default)]
    pub video_end_seconds: Option<f64>,
    #[serde(default)]
    pub levels: Vec<TrackLevel>,
    #[serde(default)]
    pub removed: Vec<Span>,
    #[serde(default)]
    pub blanked: Vec<Span>,
    #[serde(default)]
    pub muted: Vec<TrackCut>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    pub start_seconds: f64,
    pub end_seconds: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackCut {
    pub stream: u32,
    pub start_seconds: f64,
    pub end_seconds: f64,
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
pub struct ExportGifRequest {
    pub source: PathBuf,
    pub destination: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportedGif {
    pub path: PathBuf,
    pub source: PathBuf,
    pub width: u32,
    pub height: u32,
    pub frames: u32,
    pub duration_seconds: f64,
    pub size_bytes: u64,
    pub truncated: bool,
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
