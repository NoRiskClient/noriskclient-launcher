use anyhow::Result;
use ffmpeg_next as ffmpeg;
use ffmpeg_next::ffi as ff;
use norisk_ipc::{ClipCodec, EncoderCapability, EncoderPreference};

use crate::capture::CaptureDevice;
use crate::encoder::hw::{av_error, HwFramePool};

struct Candidate {
    preference: EncoderPreference,
    name: &'static str,
    vendor: &'static str,
    hardware: bool,
}

const PROBE_SIZE: (u32, u32) = (1920, 1080);

fn candidates(codec: ClipCodec) -> &'static [Candidate] {
    match codec {
        ClipCodec::H264 => &[
            Candidate { preference: EncoderPreference::Nvenc,     name: "h264_nvenc", vendor: "NVIDIA NVENC",     hardware: true },
            Candidate { preference: EncoderPreference::Amf,       name: "h264_amf",   vendor: "AMD AMF",          hardware: true },
            Candidate { preference: EncoderPreference::QuickSync, name: "h264_qsv",   vendor: "Intel Quick Sync", hardware: true },
            Candidate { preference: EncoderPreference::Software,  name: "libx264",    vendor: "x264",             hardware: false },
        ],
        ClipCodec::H265 => &[
            Candidate { preference: EncoderPreference::Nvenc,     name: "hevc_nvenc", vendor: "NVIDIA NVENC",     hardware: true },
            Candidate { preference: EncoderPreference::Amf,       name: "hevc_amf",   vendor: "AMD AMF",          hardware: true },
            Candidate { preference: EncoderPreference::QuickSync, name: "hevc_qsv",   vendor: "Intel Quick Sync", hardware: true },
            Candidate { preference: EncoderPreference::Software,  name: "libx265",    vendor: "x265",             hardware: false },
        ],
        ClipCodec::Av1 => &[
            Candidate { preference: EncoderPreference::Nvenc,     name: "av1_nvenc",  vendor: "NVIDIA NVENC",     hardware: true },
            Candidate { preference: EncoderPreference::Amf,       name: "av1_amf",    vendor: "AMD AMF",          hardware: true },
            Candidate { preference: EncoderPreference::QuickSync, name: "av1_qsv",    vendor: "Intel Quick Sync", hardware: true },
            Candidate { preference: EncoderPreference::Software,  name: "libsvtav1",  vendor: "SVT-AV1",          hardware: false },
        ],
    }
}

pub fn encoder_name(codec: ClipCodec, preference: EncoderPreference) -> Option<&'static str> {
    candidates(codec)
        .iter()
        .find(|c| c.preference == preference)
        .map(|c| c.name)
}

#[derive(Debug, Clone)]
pub struct ProbeResult {
    pub codec: ClipCodec,
    pub preference: EncoderPreference,
    pub encoder: &'static str,
    pub vendor: &'static str,
    pub hardware: bool,
    pub compiled_in: bool,
    pub opens: bool,
    pub detail: Option<String>,
}

pub fn probe_all() -> Vec<ProbeResult> {
    if let Err(e) = ffmpeg::init() {
        log::error!("FFmpeg init failed: {e}");
        return Vec::new();
    }

    let previous = ffmpeg::util::log::get_level().ok();
    ffmpeg::util::log::set_level(ffmpeg::util::log::Level::Quiet);

    let hardware_context = match CaptureDevice::new_default()
        .and_then(|device| HwFramePool::new(&device, PROBE_SIZE.0, PROBE_SIZE.1).map(|p| (device, p)))
    {
        Ok((device, pool)) => Some((device, pool)),
        Err(e) => {
            log::warn!("No D3D11 device for probing; hardware encoders cannot be tested: {e:#}");
            None
        }
    };

    let mut results = Vec::new();
    for codec in ClipCodec::all() {
        for candidate in candidates(codec) {
            results.push(probe_one(
                codec,
                candidate,
                hardware_context.as_ref().map(|(_, pool)| pool),
            ));
        }
    }

    if let Some(previous) = previous {
        ffmpeg::util::log::set_level(previous);
    }

    results
}

fn probe_one(
    codec: ClipCodec,
    candidate: &'static Candidate,
    pool: Option<&HwFramePool>,
) -> ProbeResult {
    let mut result = ProbeResult {
        codec,
        preference: candidate.preference,
        encoder: candidate.name,
        vendor: candidate.vendor,
        hardware: candidate.hardware,
        compiled_in: false,
        opens: false,
        detail: None,
    };

    let Ok(name) = std::ffi::CString::new(candidate.name) else {
        result.detail = Some("invalid encoder name".into());
        return result;
    };

    let codec_ptr = unsafe { ff::avcodec_find_encoder_by_name(name.as_ptr()) };
    if codec_ptr.is_null() {
        result.detail = Some("not present in this FFmpeg build".into());
        return result;
    }
    result.compiled_in = true;

    if candidate.hardware {
        let Some(pool) = pool else {
            result.detail = Some("no graphics device available to test with".into());
            return result;
        };
        match try_open_hardware(codec_ptr, pool) {
            Ok(()) => result.opens = true,
            Err(e) => result.detail = Some(shorten(&e.to_string())),
        }
    } else {
        match try_open_software(codec_ptr) {
            Ok(()) => result.opens = true,
            Err(e) => result.detail = Some(shorten(&e.to_string())),
        }
    }

    result
}

fn try_open_hardware(codec: *const ff::AVCodec, pool: &HwFramePool) -> Result<()> {
    unsafe {
        let context = ff::avcodec_alloc_context3(codec);
        if context.is_null() {
            anyhow::bail!("avcodec_alloc_context3 failed");
        }
        let _guard = ContextGuard(context);

        (*context).width = PROBE_SIZE.0 as i32;
        (*context).height = PROBE_SIZE.1 as i32;
        (*context).time_base = ff::AVRational { num: 1, den: 60 };
        (*context).framerate = ff::AVRational { num: 60, den: 1 };
        (*context).pix_fmt = ff::AVPixelFormat::AV_PIX_FMT_D3D11;
        (*context).sw_pix_fmt = ff::AVPixelFormat::AV_PIX_FMT_NV12;
        (*context).hw_frames_ctx = pool.frames_ref()?;

        let rc = ff::avcodec_open2(context, codec, std::ptr::null_mut());
        if rc < 0 {
            anyhow::bail!("{}", av_error(rc));
        }
        Ok(())
    }
}

fn try_open_software(codec: *const ff::AVCodec) -> Result<()> {
    const FORMATS: [ff::AVPixelFormat; 2] = [
        ff::AVPixelFormat::AV_PIX_FMT_NV12,
        ff::AVPixelFormat::AV_PIX_FMT_YUV420P,
    ];

    let mut last: Option<String> = None;

    for format in FORMATS {
        unsafe {
            let context = ff::avcodec_alloc_context3(codec);
            if context.is_null() {
                anyhow::bail!("avcodec_alloc_context3 failed");
            }
            let _guard = ContextGuard(context);

            (*context).width = PROBE_SIZE.0 as i32;
            (*context).height = PROBE_SIZE.1 as i32;
            (*context).time_base = ff::AVRational { num: 1, den: 60 };
            (*context).framerate = ff::AVRational { num: 60, den: 1 };
            (*context).pix_fmt = format;

            let rc = ff::avcodec_open2(context, codec, std::ptr::null_mut());
            if rc >= 0 {
                return Ok(());
            }
            last = Some(av_error(rc));
        }
    }

    anyhow::bail!("{}", last.unwrap_or_else(|| "could not be opened".into()))
}

struct ContextGuard(*mut ff::AVCodecContext);

impl Drop for ContextGuard {
    fn drop(&mut self) {
        unsafe {
            ff::avcodec_free_context(&mut self.0);
        }
    }
}

fn shorten(message: &str) -> String {
    let trimmed = message.trim();
    match trimmed.char_indices().nth(160) {
        Some((cut, _)) => format!("{}…", &trimmed[..cut]),
        None => trimmed.to_string(),
    }
}

pub fn capabilities() -> Vec<EncoderCapability> {
    probe_all()
        .into_iter()
        .map(|r| EncoderCapability {
            codec: r.codec,
            encoder: r.preference,
            available: r.opens,
            hardware: r.hardware,
            detail: r.detail,
        })
        .collect()
}

pub fn available_for(codec: ClipCodec, capabilities: &[EncoderCapability]) -> Vec<EncoderPreference> {
    capabilities
        .iter()
        .filter(|c| c.codec == codec && c.available)
        .map(|c| c.encoder)
        .collect()
}

pub fn resolve(
    requested: EncoderPreference,
    available: &[EncoderPreference],
) -> Option<EncoderPreference> {
    let resolved = requested.resolve(available);
    if resolved != Some(requested) && requested != EncoderPreference::Auto {
        log::warn!(
            "Encoder {:?} is not usable on this machine, falling back to {:?}",
            requested,
            resolved
        );
    }
    resolved
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_codec_offers_hardware_before_software() {
        for codec in ClipCodec::all() {
            let list = candidates(codec);
            let software_at = list.iter().position(|c| !c.hardware);
            assert_eq!(
                software_at,
                Some(list.len() - 1),
                "{codec:?} must list its software encoder last"
            );
        }
    }

    #[test]
    fn every_codec_has_all_three_vendors_plus_software() {
        for codec in ClipCodec::all() {
            let list = candidates(codec);
            assert_eq!(list.len(), 4, "{codec:?} should cover NVIDIA, AMD, Intel and software");
            assert!(list.iter().filter(|c| c.hardware).count() == 3);
        }
    }

    #[test]
    fn encoder_names_resolve_for_known_pairings() {
        assert_eq!(encoder_name(ClipCodec::H264, EncoderPreference::Nvenc), Some("h264_nvenc"));
        assert_eq!(encoder_name(ClipCodec::Av1, EncoderPreference::Nvenc), Some("av1_nvenc"));
        assert_eq!(encoder_name(ClipCodec::H265, EncoderPreference::Software), Some("libx265"));
        assert_eq!(encoder_name(ClipCodec::H264, EncoderPreference::Auto), None);
    }
}
