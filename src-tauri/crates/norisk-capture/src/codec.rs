use anyhow::{bail, Result};
use ffmpeg_next::ffi as ff;

use crate::buffer::Packet;
use crate::encoder::hw::av_error;
use crate::writer::TrackInfo;

pub(crate) struct Decoder {
    context: *mut ff::AVCodecContext,
    packet: *mut ff::AVPacket,
}

impl Decoder {
    pub(crate) fn open(track: &TrackInfo) -> Result<Self> {
        unsafe {
            let id = match track.codec {
                norisk_ipc::ClipCodec::H264 => ff::AVCodecID::AV_CODEC_ID_H264,
                norisk_ipc::ClipCodec::H265 => ff::AVCodecID::AV_CODEC_ID_HEVC,
                norisk_ipc::ClipCodec::Av1 => ff::AVCodecID::AV_CODEC_ID_AV1,
            };

            let codec = ff::avcodec_find_decoder(id);
            if codec.is_null() {
                bail!("no decoder for {:?} in this FFmpeg build", track.codec);
            }

            let context = ff::avcodec_alloc_context3(codec);
            if context.is_null() {
                bail!("avcodec_alloc_context3 failed for the video decoder");
            }

            let mut guard = Self {
                context,
                packet: std::ptr::null_mut(),
            };

            (*context).width = track.width as i32;
            (*context).height = track.height as i32;
            (*context).thread_count = decode_threads();
            (*context).thread_type = ff::FF_THREAD_FRAME as i32 | ff::FF_THREAD_SLICE as i32;

            if !track.extradata.is_empty() {
                let size = track.extradata.len();
                let buffer =
                    ff::av_mallocz(size + ff::AV_INPUT_BUFFER_PADDING_SIZE as usize) as *mut u8;
                if buffer.is_null() {
                    bail!("could not allocate room for the stream header");
                }
                std::ptr::copy_nonoverlapping(track.extradata.as_ptr(), buffer, size);
                (*context).extradata = buffer;
                (*context).extradata_size = size as i32;
            }

            let rc = ff::avcodec_open2(context, codec, std::ptr::null_mut());
            if rc < 0 {
                bail!("opening the video decoder failed: {}", av_error(rc));
            }

            guard.packet = ff::av_packet_alloc();
            if guard.packet.is_null() {
                bail!("av_packet_alloc failed");
            }

            Ok(guard)
        }
    }

    pub(crate) fn push(&mut self, packet: &Packet) -> Result<Vec<Frame>> {
        unsafe {
            ff::av_packet_unref(self.packet);
            let rc = ff::av_new_packet(self.packet, packet.len() as i32);
            if rc < 0 {
                bail!("av_new_packet failed: {}", av_error(rc));
            }
            std::ptr::copy_nonoverlapping(
                packet.data.as_ptr(),
                (*self.packet).data,
                packet.len(),
            );
            (*self.packet).pts = packet.pts;
            (*self.packet).dts = packet.dts;
            if packet.keyframe {
                (*self.packet).flags |= ff::AV_PKT_FLAG_KEY as i32;
            }

            let rc = ff::avcodec_send_packet(self.context, self.packet);
            if rc < 0 && rc != ff::AVERROR(ff::EAGAIN) {
                bail!("avcodec_send_packet failed: {}", av_error(rc));
            }
        }
        self.drain()
    }

    pub(crate) fn finish(&mut self) -> Result<Vec<Frame>> {
        unsafe {
            let rc = ff::avcodec_send_packet(self.context, std::ptr::null());
            if rc < 0 && rc != ff::AVERROR_EOF {
                bail!("flushing the video decoder failed: {}", av_error(rc));
            }
        }
        self.drain()
    }

    fn drain(&mut self) -> Result<Vec<Frame>> {
        let mut out = Vec::new();
        loop {
            let frame = Frame::alloc()?;
            let rc = unsafe { ff::avcodec_receive_frame(self.context, frame.0) };
            if rc == ff::AVERROR(ff::EAGAIN) || rc == ff::AVERROR_EOF {
                break;
            }
            if rc < 0 {
                bail!("avcodec_receive_frame failed: {}", av_error(rc));
            }
            out.push(frame);
        }
        Ok(out)
    }
}

impl Drop for Decoder {
    fn drop(&mut self) {
        unsafe {
            ff::av_packet_free(&mut self.packet);
            ff::avcodec_free_context(&mut self.context);
        }
    }
}

pub(crate) struct Frame(pub(crate) *mut ff::AVFrame);

impl Frame {
    fn alloc() -> Result<Self> {
        let frame = unsafe { ff::av_frame_alloc() };
        if frame.is_null() {
            bail!("av_frame_alloc failed");
        }
        Ok(Self(frame))
    }
}

impl Drop for Frame {
    fn drop(&mut self) {
        unsafe { ff::av_frame_free(&mut self.0) };
    }
}

unsafe impl Send for Decoder {}

fn decode_threads() -> i32 {
    std::thread::available_parallelism().map_or(0, |cores| (cores.get() / 2).clamp(1, 8) as i32)
}

pub(crate) fn shown_at(frame: &Frame) -> i64 {
    unsafe {
        if (*frame.0).pts == ff::AV_NOPTS_VALUE {
            (*frame.0).best_effort_timestamp
        } else {
            (*frame.0).pts
        }
    }
}

pub(crate) fn planar_420(frame: &Frame, purpose: &str) -> Result<bool> {
    let format = unsafe { (*frame.0).format };
    if format == ff::AVPixelFormat::AV_PIX_FMT_YUV420P as i32 {
        return Ok(false);
    }
    if format == ff::AVPixelFormat::AV_PIX_FMT_YUVJ420P as i32 {
        return Ok(true);
    }
    bail!("{purpose} needs 8-bit planar 4:2:0 video, but this clip decoded to format {format}");
}
