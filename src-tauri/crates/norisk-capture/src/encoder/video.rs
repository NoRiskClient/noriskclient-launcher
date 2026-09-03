use anyhow::{bail, Context, Result};
use ffmpeg_next::ffi as ff;
use norisk_ipc::ClipCodec;

use super::hw::{av_error, HwFramePool, PoolFrame};
use super::sw::{Downloader, SOFTWARE_FORMATS};

pub const TIME_BASE_DEN: i32 = 90_000;

#[derive(Debug, Clone, Copy)]
pub struct EncoderSettings {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate_kbps: u32,
    pub gop_seconds: f32,
    pub codec: ClipCodec,
}

impl Default for EncoderSettings {
    fn default() -> Self {
        Self {
            width: 1920,
            height: 1080,
            fps: 60,
            bitrate_kbps: 20_000,
            gop_seconds: 2.0,
            codec: ClipCodec::H264,
        }
    }
}

pub use crate::buffer::Packet as EncodedPacket;

pub struct VideoEncoder {
    context: *mut ff::AVCodecContext,
    packet: *mut ff::AVPacket,
    settings: EncoderSettings,
    frames_sent: u64,
    gop_ticks: i64,
    last_keyframe_pts: Option<i64>,
    download: Option<Downloader>,
}

unsafe impl Send for VideoEncoder {}

impl VideoEncoder {
    pub fn open(codec_name: &str, pool: &HwFramePool, settings: EncoderSettings) -> Result<Self> {
        let c_name = std::ffi::CString::new(codec_name).context("codec name has an interior nul")?;

        let codec = unsafe { ff::avcodec_find_encoder_by_name(c_name.as_ptr()) };
        if codec.is_null() {
            bail!("encoder '{codec_name}' is not in this FFmpeg build");
        }

        let hardware =
            unsafe { (*codec).capabilities & ff::AV_CODEC_CAP_HARDWARE as i32 != 0 };

        let (context, download) = if hardware {
            (open_hardware(codec, codec_name, pool, settings)?, None)
        } else {
            let (context, format) = open_software(codec, codec_name, settings)?;
            let downloader = Downloader::new(format, settings.width, settings.height)
                .inspect_err(|_| unsafe {
                    ff::avcodec_free_context(&mut { context } as *mut _);
                })?;
            (context, Some(downloader))
        };

        let packet = unsafe { ff::av_packet_alloc() };
        if packet.is_null() {
            unsafe { ff::avcodec_free_context(&mut { context } as *mut _) };
            bail!("av_packet_alloc failed");
        }

        log::info!(
            "Encoder open: {codec_name} ({}) {}x{} @ {} fps, {} kbps, GOP {} frames, {} B-frames",
            if hardware { "GPU" } else { "CPU" },
            settings.width,
            settings.height,
            settings.fps,
            settings.bitrate_kbps,
            unsafe { (*context).gop_size },
            unsafe { (*context).max_b_frames }
        );

        Ok(Self {
            context,
            packet,
            settings,

            frames_sent: 0,
            gop_ticks: gop_ticks(settings),
            last_keyframe_pts: None,
            download,
        })
    }

    pub fn extradata(&self) -> Vec<u8> {
        unsafe {
            let context = &*self.context;
            if context.extradata.is_null() || context.extradata_size <= 0 {
                return Vec::new();
            }
            std::slice::from_raw_parts(context.extradata, context.extradata_size as usize).to_vec()
        }
    }

    pub fn settings(&self) -> EncoderSettings {
        self.settings
    }

    pub fn encode(&mut self, frame: &PoolFrame) -> Result<Vec<EncodedPacket>> {
        let submitted = match self.download.as_mut() {
            Some(downloader) => downloader.download(frame)?,
            None => frame.as_ptr(),
        };

        unsafe {
            let pts = (*submitted).pts;
            let due = match self.last_keyframe_pts {
                None => true,
                Some(last) => pts.saturating_sub(last) >= self.gop_ticks,
            };
            if due {
                (*submitted).pict_type = ff::AVPictureType::AV_PICTURE_TYPE_I;
                self.last_keyframe_pts = Some(pts);
            } else {
                (*submitted).pict_type = ff::AVPictureType::AV_PICTURE_TYPE_NONE;
            }
        }

        let rc = unsafe { ff::avcodec_send_frame(self.context, submitted) };
        if rc < 0 {
            bail!("avcodec_send_frame failed: {}", av_error(rc));
        }
        self.frames_sent += 1;
        self.drain()
    }

    pub fn finish(&mut self) -> Result<Vec<EncodedPacket>> {
        let rc = unsafe { ff::avcodec_send_frame(self.context, std::ptr::null()) };
        if rc < 0 && rc != ff::AVERROR_EOF {
            bail!("flushing the encoder failed: {}", av_error(rc));
        }
        self.drain()
    }

    fn drain(&mut self) -> Result<Vec<EncodedPacket>> {
        let mut out = Vec::new();

        loop {
            let rc = unsafe { ff::avcodec_receive_packet(self.context, self.packet) };

            if rc == averror_again() || rc == ff::AVERROR_EOF {
                break;
            }
            if rc < 0 {
                bail!("avcodec_receive_packet failed: {}", av_error(rc));
            }

            unsafe {
                let packet = &*self.packet;
                let bytes =
                    std::slice::from_raw_parts(packet.data, packet.size.max(0) as usize).to_vec();

                out.push(EncodedPacket {
                    data: bytes.into(),
                    pts: packet.pts,
                    dts: packet.dts,
                    keyframe: packet.flags & ff::AV_PKT_FLAG_KEY != 0,
                });

                ff::av_packet_unref(self.packet);
            }
        }

        Ok(out)
    }
}

impl Drop for VideoEncoder {
    fn drop(&mut self) {
        unsafe {
            if !self.packet.is_null() {
                ff::av_packet_free(&mut self.packet);
            }
            if !self.context.is_null() {
                ff::avcodec_free_context(&mut self.context);
            }
        }
    }
}

unsafe fn configure_common(
    context: *mut ff::AVCodecContext,
    codec_name: &str,
    settings: EncoderSettings,
    cap_rate: bool,
    tuned: bool,
) {
    (*context).width = settings.width as i32;
    (*context).height = settings.height as i32;
    (*context).time_base = ff::AVRational {
        num: 1,
        den: TIME_BASE_DEN,
    };
    (*context).framerate = ff::AVRational {
        num: settings.fps as i32,
        den: 1,
    };
    (*context).bit_rate = settings.bitrate_kbps as i64 * 1000;
    if cap_rate {
        (*context).rc_max_rate = (*context).bit_rate;
        (*context).rc_buffer_size = (*context).bit_rate as i32;
    }
    (*context).gop_size = gop_frames(settings);
    (*context).max_b_frames = if tuned { b_frames_for(codec_name) } else { 0 };

    (*context).flags |= ff::AV_CODEC_FLAG_GLOBAL_HEADER as i32;

    if (*context).priv_data.is_null() {
        return;
    }

    set_option(context, codec_name, "forced-idr", "1");
    if tuned {
        for (key, value) in tuning_for(codec_name) {
            set_option(context, codec_name, key, value);
        }
    }
}

fn b_frames_for(codec_name: &str) -> i32 {
    let hardware = ["_nvenc", "_amf", "_qsv"]
        .iter()
        .any(|suffix| codec_name.ends_with(suffix));
    if hardware && !codec_name.starts_with("av1") {
        2
    } else {
        0
    }
}

fn tuning_for(codec_name: &str) -> &'static [(&'static str, &'static str)] {
    match codec_name {
        name if name.ends_with("_nvenc") => &[
            ("preset", "p5"),
            ("tune", "hq"),
            ("rc", "vbr"),
            ("multipass", "qres"),
            ("spatial-aq", "1"),
            ("temporal-aq", "1"),
        ],
        name if name.ends_with("_amf") => &[
            ("quality", "quality"),
            ("rc", "vbr_peak"),
            ("preanalysis", "1"),
        ],
        name if name.ends_with("_qsv") => &[("preset", "slow")],
        "libx264" => &[("preset", "veryfast"), ("tune", "zerolatency")],
        "libx265" => &[("preset", "ultrafast"), ("tune", "zerolatency")],
        "libsvtav1" => &[("preset", "10")],
        _ => &[],
    }
}

unsafe fn set_option(context: *mut ff::AVCodecContext, codec_name: &str, key: &str, value: &str) {
    let key_c = std::ffi::CString::new(key).unwrap();
    let value_c = std::ffi::CString::new(value).unwrap();
    let rc = ff::av_opt_set((*context).priv_data, key_c.as_ptr(), value_c.as_ptr(), 0);
    if rc < 0 {
        log::debug!("'{codec_name}' ignored {key}={value}: {}", av_error(rc));
    }
}

fn open_hardware(
    codec: *const ff::AVCodec,
    codec_name: &str,
    pool: &HwFramePool,
    settings: EncoderSettings,
) -> Result<*mut ff::AVCodecContext> {
    unsafe {
        let mut last = String::new();

        for tuned in [true, false] {
            let context = ff::avcodec_alloc_context3(codec);
            if context.is_null() {
                bail!("avcodec_alloc_context3 failed");
            }
            let mut guard = ContextGuard(context);

            configure_common(context, codec_name, settings, true, tuned);
            (*context).pix_fmt = ff::AVPixelFormat::AV_PIX_FMT_D3D11;
            (*context).sw_pix_fmt = ff::AVPixelFormat::AV_PIX_FMT_NV12;
            (*context).hw_frames_ctx = pool
                .frames_ref()
                .context("could not reference the frame pool")?;

            let rc = ff::avcodec_open2(context, codec, std::ptr::null_mut());
            if rc >= 0 {
                if !tuned {
                    log::warn!("'{codec_name}' only opens with vendor defaults: {last}");
                }
                return Ok(guard.release());
            }
            last = av_error(rc);
        }

        bail!("opening '{codec_name}' failed: {last}")
    }
}

fn open_software(
    codec: *const ff::AVCodec,
    codec_name: &str,
    settings: EncoderSettings,
) -> Result<(*mut ff::AVCodecContext, ff::AVPixelFormat)> {
    let mut last: Option<String> = None;

    for cap_rate in [true, false] {
        for format in SOFTWARE_FORMATS {
            unsafe {
                let context = ff::avcodec_alloc_context3(codec);
                if context.is_null() {
                    bail!("avcodec_alloc_context3 failed");
                }
                let mut guard = ContextGuard(context);

                configure_common(context, codec_name, settings, cap_rate, true);
                (*context).pix_fmt = format;
                (*context).thread_count = 0;

                let rc = ff::avcodec_open2(context, codec, std::ptr::null_mut());
                if rc >= 0 {
                    log::info!(
                        "'{codec_name}' accepted {format:?}{}",
                        if cap_rate {
                            ""
                        } else {
                            " without a bitrate ceiling"
                        }
                    );
                    return Ok((guard.release(), format));
                }
                last = Some(av_error(rc));
                log::debug!("'{codec_name}' rejected {format:?}: {}", av_error(rc));
            }
        }
    }

    bail!(
        "opening '{codec_name}' failed in every supported configuration: {}",
        last.unwrap_or_else(|| "nothing was tried".into())
    )
}

struct ContextGuard(*mut ff::AVCodecContext);

impl ContextGuard {
    fn release(&mut self) -> *mut ff::AVCodecContext {
        std::mem::replace(&mut self.0, std::ptr::null_mut())
    }
}

impl Drop for ContextGuard {
    fn drop(&mut self) {
        unsafe {
            if !self.0.is_null() {
                ff::avcodec_free_context(&mut self.0);
            }
        }
    }
}

fn gop_frames(settings: EncoderSettings) -> i32 {
    let raw = (settings.gop_seconds * settings.fps as f32).round();
    (raw as i32).clamp(1, 600)
}

fn gop_ticks(settings: EncoderSettings) -> i64 {
    let raw = (settings.gop_seconds.max(0.1) as f64 * TIME_BASE_DEN as f64) as i64;
    raw.clamp(TIME_BASE_DEN as i64 / 10, TIME_BASE_DEN as i64 * 10)
}

fn averror_again() -> i32 {
    ff::AVERROR(ff::EAGAIN)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gop_follows_the_configured_seconds() {
        let base = EncoderSettings {
            fps: 60,
            gop_seconds: 2.0,
            ..Default::default()
        };
        assert_eq!(gop_frames(base), 120);

        assert_eq!(
            gop_frames(EncoderSettings {
                gop_seconds: 1.0,
                ..base
            }),
            60
        );
        assert_eq!(
            gop_frames(EncoderSettings {
                fps: 144,
                gop_seconds: 2.0,
                ..base
            }),
            288
        );
    }

    #[test]
    fn keyframe_spacing_in_ticks_ignores_the_frame_rate() {
        let at_60 = gop_ticks(EncoderSettings {
            fps: 60,
            gop_seconds: 2.0,
            ..Default::default()
        });
        let at_30 = gop_ticks(EncoderSettings {
            fps: 30,
            gop_seconds: 2.0,
            ..Default::default()
        });
        assert_eq!(at_60, at_30);
        assert_eq!(at_60, 2 * TIME_BASE_DEN as i64);

        assert_ne!(
            gop_frames(EncoderSettings { fps: 60, gop_seconds: 2.0, ..Default::default() }),
            gop_frames(EncoderSettings { fps: 30, gop_seconds: 2.0, ..Default::default() }),
        );
    }

    #[test]
    fn a_degenerate_gop_is_clamped_rather_than_zero() {
        assert_eq!(
            gop_frames(EncoderSettings {
                gop_seconds: 0.0,
                ..Default::default()
            }),
            1
        );
        assert_eq!(
            gop_frames(EncoderSettings {
                gop_seconds: 3600.0,
                ..Default::default()
            }),
            600
        );
    }
}
