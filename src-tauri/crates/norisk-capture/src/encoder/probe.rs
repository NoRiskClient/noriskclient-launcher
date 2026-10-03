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
    pub driver_too_old: bool,
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
        driver_too_old: false,
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

    let takes_gpu_frames =
        unsafe { (*codec_ptr).capabilities & ff::AV_CODEC_CAP_HARDWARE as i32 != 0 };

    if takes_gpu_frames {
        let Some(pool) = pool else {
            result.detail = Some("no graphics device available to test with".into());
            return result;
        };
        match try_open_hardware(codec_ptr, pool) {
            Ok(()) => result.opens = true,
            Err(e) => {
                result.driver_too_old = driver_too_old(candidate, &e.to_string());
                result.detail = Some(if result.driver_too_old {
                    "the NVIDIA driver is too old for NVENC; version 570 or newer is needed".into()
                } else {
                    shorten(&e.to_string())
                });
            }
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

fn driver_too_old(candidate: &Candidate, error: &str) -> bool {
    candidate.preference == EncoderPreference::Nvenc && error.contains("not implemented")
}

fn shorten(message: &str) -> String {
    let trimmed = message.trim();
    match trimmed.char_indices().nth(160) {
        Some((cut, _)) => format!("{}…", &trimmed[..cut]),
        None => trimmed.to_string(),
    }
}

pub fn capabilities() -> Vec<EncoderCapability> {
    static MEASURED: std::sync::OnceLock<Vec<EncoderCapability>> = std::sync::OnceLock::new();
    MEASURED.get_or_init(measure_capabilities).clone()
}

fn measure_capabilities() -> Vec<EncoderCapability> {
    probe_all()
        .into_iter()
        .map(|r| EncoderCapability {
            codec: r.codec,
            encoder: r.preference,
            available: r.opens,
            hardware: r.hardware,
            detail: r.detail,
            driver_too_old: r.driver_too_old,
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
    fn only_an_nvenc_that_ffmpeg_calls_unimplemented_means_an_old_driver() {
        let nvenc = &candidates(ClipCodec::H264)[0];
        let amf = &candidates(ClipCodec::H264)[1];
        let unimplemented = av_error(ff::AVERROR(ff::ENOSYS));

        assert!(driver_too_old(nvenc, &unimplemented), "FFmpeg said {unimplemented:?}");
        assert!(!driver_too_old(nvenc, &av_error(ff::AVERROR(ff::EINVAL))));
        assert!(!driver_too_old(amf, &unimplemented));
    }
}
