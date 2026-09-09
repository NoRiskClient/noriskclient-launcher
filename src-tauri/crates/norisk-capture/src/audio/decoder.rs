
use anyhow::{bail, Context, Result};
use ffmpeg_next::ffi as ff;

use crate::buffer::Packet;
use crate::encoder::hw::av_error;

use super::encoder::{OUTPUT_CHANNELS, OUTPUT_SAMPLE_RATE};

pub struct AudioDecoder {
    context: *mut ff::AVCodecContext,
    frame: *mut ff::AVFrame,
    packet: *mut ff::AVPacket,
    resampler: *mut ff::SwrContext,
}

unsafe impl Send for AudioDecoder {}

impl AudioDecoder {
    pub fn open(sample_rate: u32, channels: u32, extradata: &[u8]) -> Result<Self> {
        unsafe {
            let codec = ff::avcodec_find_decoder(ff::AVCodecID::AV_CODEC_ID_AAC);
            if codec.is_null() {
                bail!("no AAC decoder in this FFmpeg build");
            }

            let context = ff::avcodec_alloc_context3(codec);
            if context.is_null() {
                bail!("avcodec_alloc_context3 failed for the audio decoder");
            }

            let mut decoder = Self {
                context,
                frame: std::ptr::null_mut(),
                packet: std::ptr::null_mut(),
                resampler: std::ptr::null_mut(),
            };

            (*context).sample_rate = sample_rate.max(1) as i32;
            ff::av_channel_layout_default(&mut (*context).ch_layout, channels.max(1) as i32);

            if extradata.is_empty() {
                bail!("this audio track has no codec header, so it cannot be decoded");
            }
            let buffer =
                ff::av_malloc(extradata.len() + ff::AV_INPUT_BUFFER_PADDING_SIZE as usize)
                    as *mut u8;
            if buffer.is_null() {
                bail!("could not allocate the decoder header");
            }
            std::ptr::copy_nonoverlapping(extradata.as_ptr(), buffer, extradata.len());
            std::ptr::write_bytes(
                buffer.add(extradata.len()),
                0,
                ff::AV_INPUT_BUFFER_PADDING_SIZE as usize,
            );
            (*context).extradata = buffer;
            (*context).extradata_size = extradata.len() as i32;

            let rc = ff::avcodec_open2(context, codec, std::ptr::null_mut());
            if rc < 0 {
                bail!("opening the AAC decoder failed: {}", av_error(rc));
            }

            decoder.frame = ff::av_frame_alloc();
            decoder.packet = ff::av_packet_alloc();
            if decoder.frame.is_null() || decoder.packet.is_null() {
                bail!("could not allocate the decoder's frame or packet");
            }

            Ok(decoder)
        }
    }

    pub fn push(&mut self, source: &Packet) -> Result<Vec<f32>> {
        unsafe {
            let rc = ff::av_new_packet(self.packet, source.data.len() as i32);
            if rc < 0 {
                bail!("av_new_packet failed: {}", av_error(rc));
            }
            std::ptr::copy_nonoverlapping(
                source.data.as_ptr(),
                (*self.packet).data,
                source.data.len(),
            );
            (*self.packet).pts = source.pts;
            (*self.packet).dts = source.dts;

            let rc = ff::avcodec_send_packet(self.context, self.packet);
            ff::av_packet_unref(self.packet);
            if rc < 0 && rc != ff::AVERROR(ff::EAGAIN) {
                bail!("avcodec_send_packet failed: {}", av_error(rc));
            }
        }
        self.drain()
    }

    pub fn finish(&mut self) -> Result<Vec<f32>> {
        let rc = unsafe { ff::avcodec_send_packet(self.context, std::ptr::null()) };
        if rc < 0 && rc != ff::AVERROR_EOF {
            bail!("flushing the audio decoder failed: {}", av_error(rc));
        }
        self.drain()
    }

    fn drain(&mut self) -> Result<Vec<f32>> {
        let mut out = Vec::new();

        loop {
            let rc = unsafe { ff::avcodec_receive_frame(self.context, self.frame) };
            if rc == ff::AVERROR(ff::EAGAIN) || rc == ff::AVERROR_EOF {
                break;
            }
            if rc < 0 {
                bail!("avcodec_receive_frame failed: {}", av_error(rc));
            }

            out.extend(self.interleave()?);
            unsafe { ff::av_frame_unref(self.frame) };
        }

        Ok(out)
    }

    fn interleave(&mut self) -> Result<Vec<f32>> {
        unsafe {
            if self.resampler.is_null() {
                let mut out_layout = std::mem::zeroed::<ff::AVChannelLayout>();
                ff::av_channel_layout_default(&mut out_layout, OUTPUT_CHANNELS);

                let mut resampler: *mut ff::SwrContext = std::ptr::null_mut();
                let rc = ff::swr_alloc_set_opts2(
                    &mut resampler,
                    &out_layout,
                    ff::AVSampleFormat::AV_SAMPLE_FMT_FLT,
                    OUTPUT_SAMPLE_RATE,
                    &(*self.frame).ch_layout,
                    std::mem::transmute::<i32, ff::AVSampleFormat>((*self.frame).format),
                    (*self.frame).sample_rate,
                    0,
                    std::ptr::null_mut(),
                );
                if rc < 0 || resampler.is_null() {
                    bail!("could not set up the decoder's resampler: {}", av_error(rc));
                }
                let rc = ff::swr_init(resampler);
                if rc < 0 {
                    ff::swr_free(&mut resampler);
                    bail!("swr_init failed for the decoder: {}", av_error(rc));
                }
                self.resampler = resampler;
            }

            let in_frames = (*self.frame).nb_samples;
            if in_frames <= 0 {
                return Ok(Vec::new());
            }

            let max_out =
                ff::swr_get_out_samples(self.resampler, in_frames).max(in_frames) as usize + 256;
            let mut output = vec![0f32; max_out * OUTPUT_CHANNELS as usize];

            let out_ptr = output.as_mut_ptr() as *mut u8;
            let mut out_planes = [out_ptr, std::ptr::null_mut()];

            let produced = ff::swr_convert(
                self.resampler,
                out_planes.as_mut_ptr(),
                max_out as i32,
                (*self.frame).data.as_ptr() as *const *const u8,
                in_frames,
            );
            if produced < 0 {
                bail!("swr_convert failed in the decoder: {}", av_error(produced));
            }

            output.truncate(produced as usize * OUTPUT_CHANNELS as usize);
            Ok(output)
        }
    }
}

impl Drop for AudioDecoder {
    fn drop(&mut self) {
        unsafe {
            if !self.resampler.is_null() {
                ff::swr_free(&mut self.resampler);
            }
            if !self.packet.is_null() {
                ff::av_packet_free(&mut self.packet);
            }
            if !self.frame.is_null() {
                ff::av_frame_free(&mut self.frame);
            }
            if !self.context.is_null() {
                ff::avcodec_free_context(&mut self.context);
            }
        }
    }
}

pub fn decode_all(sample_rate: u32, channels: u32, extradata: &[u8], packets: &[Packet]) -> Result<Vec<f32>> {
    let mut decoder = AudioDecoder::open(sample_rate, channels, extradata)
        .context("could not open a decoder for one of the clip's audio tracks")?;

    let mut samples = Vec::new();
    for packet in packets {
        samples.extend(decoder.push(packet)?);
    }
    samples.extend(decoder.finish()?);
    Ok(samples)
}
