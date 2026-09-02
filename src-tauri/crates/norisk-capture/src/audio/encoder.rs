use anyhow::{bail, Result};
use ffmpeg_next::ffi as ff;

use crate::buffer::Packet;
use crate::encoder::hw::av_error;
use crate::encoder::video::TIME_BASE_DEN;

use super::wasapi::AudioFormat;

pub const OUTPUT_SAMPLE_RATE: i32 = 48_000;
pub const OUTPUT_CHANNELS: i32 = 2;
pub const DEFAULT_BITRATE: i64 = 160_000;

pub struct AudioEncoder {
    context: *mut ff::AVCodecContext,
    resampler: *mut ff::SwrContext,
    frame: *mut ff::AVFrame,
    packet: *mut ff::AVPacket,
    frame_size: usize,
    pending: Vec<f32>,
    pending_timestamp: Option<i64>,
    input: AudioFormat,
    frames_encoded: u64,
}

unsafe impl Send for AudioEncoder {}

impl AudioEncoder {
    pub fn open(input: AudioFormat, bitrate: i64) -> Result<Self> {
        unsafe {
            let codec = ff::avcodec_find_encoder(ff::AVCodecID::AV_CODEC_ID_AAC);
            if codec.is_null() {
                bail!("no AAC encoder in this FFmpeg build");
            }

            let context = ff::avcodec_alloc_context3(codec);
            if context.is_null() {
                bail!("avcodec_alloc_context3 failed for audio");
            }

            (*context).sample_rate = OUTPUT_SAMPLE_RATE;
            (*context).sample_fmt = ff::AVSampleFormat::AV_SAMPLE_FMT_FLTP;
            (*context).bit_rate = bitrate;
            (*context).time_base = ff::AVRational {
                num: 1,
                den: OUTPUT_SAMPLE_RATE,
            };
            ff::av_channel_layout_default(&mut (*context).ch_layout, OUTPUT_CHANNELS);
            (*context).flags |= ff::AV_CODEC_FLAG_GLOBAL_HEADER as i32;

            let mut guard = Self {
                context,
                resampler: std::ptr::null_mut(),
                frame: std::ptr::null_mut(),
                packet: std::ptr::null_mut(),
                frame_size: 1024,
                pending: Vec::new(),
                pending_timestamp: None,
                input,
                frames_encoded: 0,
            };

            let rc = ff::avcodec_open2(context, codec, std::ptr::null_mut());
            if rc < 0 {
                bail!("opening the AAC encoder failed: {}", av_error(rc));
            }

            guard.frame_size = if (*context).frame_size > 0 {
                (*context).frame_size as usize
            } else {
                1024
            };

            let mut in_layout = std::mem::zeroed::<ff::AVChannelLayout>();
            ff::av_channel_layout_default(&mut in_layout, input.channels as i32);
            let mut out_layout = std::mem::zeroed::<ff::AVChannelLayout>();
            ff::av_channel_layout_default(&mut out_layout, OUTPUT_CHANNELS);

            let mut resampler: *mut ff::SwrContext = std::ptr::null_mut();
            let rc = ff::swr_alloc_set_opts2(
                &mut resampler,
                &out_layout,
                ff::AVSampleFormat::AV_SAMPLE_FMT_FLT,
                OUTPUT_SAMPLE_RATE,
                &in_layout,
                ff::AVSampleFormat::AV_SAMPLE_FMT_FLT,
                input.sample_rate as i32,
                0,
                std::ptr::null_mut(),
            );
            if rc < 0 || resampler.is_null() {
                bail!("could not create the resampler: {}", av_error(rc));
            }
            guard.resampler = resampler;

            let rc = ff::swr_init(resampler);
            if rc < 0 {
                bail!("swr_init failed: {}", av_error(rc));
            }

            guard.frame = ff::av_frame_alloc();
            guard.packet = ff::av_packet_alloc();
            if guard.frame.is_null() || guard.packet.is_null() {
                bail!("could not allocate audio frame or packet");
            }

            (*guard.frame).nb_samples = guard.frame_size as i32;
            (*guard.frame).format = ff::AVSampleFormat::AV_SAMPLE_FMT_FLTP as i32;
            (*guard.frame).sample_rate = OUTPUT_SAMPLE_RATE;
            ff::av_channel_layout_default(&mut (*guard.frame).ch_layout, OUTPUT_CHANNELS);

            let rc = ff::av_frame_get_buffer(guard.frame, 0);
            if rc < 0 {
                bail!("could not allocate the audio frame buffer: {}", av_error(rc));
            }

            log::info!(
                "Audio encoder open: AAC {} kbps, {} Hz {}ch -> {} Hz {}ch, {} samples a frame",
                bitrate / 1000,
                input.sample_rate,
                input.channels,
                OUTPUT_SAMPLE_RATE,
                OUTPUT_CHANNELS,
                guard.frame_size
            );

            Ok(guard)
        }
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

    pub fn push(&mut self, samples: &[f32], timestamp_100ns: i64) -> Result<Vec<Packet>> {
        if samples.is_empty() {
            return Ok(Vec::new());
        }

        let converted = self.resample(samples)?;
        if self.pending.is_empty() {
            self.pending_timestamp = Some(timestamp_100ns);
        }
        self.pending.extend_from_slice(&converted);

        let per_frame = self.frame_size * OUTPUT_CHANNELS as usize;
        let mut out = Vec::new();

        while self.pending.len() >= per_frame {
            let chunk: Vec<f32> = self.pending.drain(..per_frame).collect();
            let timestamp = self.pending_timestamp.unwrap_or(timestamp_100ns);

            out.extend(self.encode_frame(&chunk, timestamp)?);

            let frame_100ns = self.frame_size as i64 * 10_000_000 / OUTPUT_SAMPLE_RATE as i64;
            self.pending_timestamp = Some(timestamp + frame_100ns);
        }

        Ok(out)
    }

    pub fn finish(&mut self) -> Result<Vec<Packet>> {
        let rc = unsafe { ff::avcodec_send_frame(self.context, std::ptr::null()) };
        if rc < 0 && rc != ff::AVERROR_EOF {
            bail!("flushing the audio encoder failed: {}", av_error(rc));
        }
        self.drain(0)
    }

    fn resample(&mut self, samples: &[f32]) -> Result<Vec<f32>> {
        let in_frames = self.input.frame_count(samples.len());
        if in_frames == 0 {
            return Ok(Vec::new());
        }

        let max_out = unsafe {
            ff::swr_get_out_samples(self.resampler, in_frames as i32).max(in_frames as i32) as usize
        } + 256;

        let mut output = vec![0f32; max_out * OUTPUT_CHANNELS as usize];

        let produced = unsafe {
            let in_ptr = samples.as_ptr() as *const u8;
            let in_planes = [in_ptr, std::ptr::null()];
            let out_ptr = output.as_mut_ptr() as *mut u8;
            let mut out_planes = [out_ptr, std::ptr::null_mut()];

            ff::swr_convert(
                self.resampler,
                out_planes.as_mut_ptr(),
                max_out as i32,
                in_planes.as_ptr(),
                in_frames as i32,
            )
        };

        if produced < 0 {
            bail!("swr_convert failed: {}", av_error(produced));
        }

        output.truncate(produced as usize * OUTPUT_CHANNELS as usize);
        Ok(output)
    }

    fn encode_frame(&mut self, interleaved: &[f32], timestamp_100ns: i64) -> Result<Vec<Packet>> {
        unsafe {
            let rc = ff::av_frame_make_writable(self.frame);
            if rc < 0 {
                bail!("audio frame is not writable: {}", av_error(rc));
            }

            let left = (*self.frame).data[0] as *mut f32;
            let right = (*self.frame).data[1] as *mut f32;
            for (i, pair) in interleaved.chunks_exact(2).enumerate() {
                *left.add(i) = pair[0];
                *right.add(i) = pair[1];
            }

            (*self.frame).pts = timestamp_100ns * OUTPUT_SAMPLE_RATE as i64 / 10_000_000;

            let rc = ff::avcodec_send_frame(self.context, self.frame);
            if rc < 0 {
                bail!("avcodec_send_frame failed for audio: {}", av_error(rc));
            }
            self.frames_encoded += 1;
        }

        self.drain(timestamp_100ns)
    }

    fn drain(&mut self, fallback_timestamp: i64) -> Result<Vec<Packet>> {
        let mut out = Vec::new();

        loop {
            let rc = unsafe { ff::avcodec_receive_packet(self.context, self.packet) };
            if rc == ff::AVERROR(ff::EAGAIN) || rc == ff::AVERROR_EOF {
                break;
            }
            if rc < 0 {
                bail!("avcodec_receive_packet failed for audio: {}", av_error(rc));
            }

            unsafe {
                let packet = &*self.packet;
                let bytes =
                    std::slice::from_raw_parts(packet.data, packet.size.max(0) as usize).to_vec();

                let pts = if packet.pts == ff::AV_NOPTS_VALUE {
                    fallback_timestamp * TIME_BASE_DEN as i64 / 10_000_000
                } else {
                    packet.pts * TIME_BASE_DEN as i64 / OUTPUT_SAMPLE_RATE as i64
                };

                out.push(Packet {
                    data: bytes.into(),
                    pts,
                    dts: pts,
                    keyframe: true,
                });

                ff::av_packet_unref(self.packet);
            }
        }

        Ok(out)
    }
}

impl Drop for AudioEncoder {
    fn drop(&mut self) {
        unsafe {
            if !self.packet.is_null() {
                ff::av_packet_free(&mut self.packet);
            }
            if !self.frame.is_null() {
                ff::av_frame_free(&mut self.frame);
            }
            if !self.resampler.is_null() {
                ff::swr_free(&mut self.resampler);
            }
            if !self.context.is_null() {
                ff::avcodec_free_context(&mut self.context);
            }
        }
    }
}
