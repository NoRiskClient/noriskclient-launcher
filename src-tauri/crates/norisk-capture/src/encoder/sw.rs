use anyhow::{bail, Context, Result};
use ffmpeg_next::ffi as ff;

use super::hw::{av_error, PoolFrame};
pub const SOFTWARE_FORMATS: [ff::AVPixelFormat; 2] = [
    ff::AVPixelFormat::AV_PIX_FMT_NV12,
    ff::AVPixelFormat::AV_PIX_FMT_YUV420P,
];

pub struct Downloader {
    staging: *mut ff::AVFrame,
    planar: *mut ff::AVFrame,
    format: ff::AVPixelFormat,
    width: i32,
    height: i32,
}

unsafe impl Send for Downloader {}

impl Downloader {
    pub fn new(format: ff::AVPixelFormat, width: u32, height: u32) -> Result<Self> {
        if !SOFTWARE_FORMATS.contains(&format) {
            bail!("{format:?} is not a format the download path can produce");
        }

        let staging = unsafe { ff::av_frame_alloc() };
        if staging.is_null() {
            bail!("av_frame_alloc failed");
        }

        let mut downloader = Self {
            staging,
            planar: std::ptr::null_mut(),
            format,
            width: width as i32,
            height: height as i32,
        };

        unsafe {
            (*staging).format = ff::AVPixelFormat::AV_PIX_FMT_NV12 as i32;
            (*staging).width = downloader.width;
            (*staging).height = downloader.height;
            let rc = ff::av_frame_get_buffer(staging, 0);
            if rc < 0 {
                bail!("could not allocate the download frame: {}", av_error(rc));
            }

            if format == ff::AVPixelFormat::AV_PIX_FMT_YUV420P {
                let planar = ff::av_frame_alloc();
                if planar.is_null() {
                    bail!("av_frame_alloc failed");
                }
                downloader.planar = planar;

                (*planar).format = format as i32;
                (*planar).width = downloader.width;
                (*planar).height = downloader.height;
                let rc = ff::av_frame_get_buffer(planar, 0);
                if rc < 0 {
                    bail!("could not allocate the conversion frame: {}", av_error(rc));
                }
            }
        }

        Ok(downloader)
    }

    pub fn download(&mut self, frame: &PoolFrame) -> Result<*mut ff::AVFrame> {
        unsafe {
            let rc = ff::av_frame_make_writable(self.staging);
            if rc < 0 {
                bail!("av_frame_make_writable failed: {}", av_error(rc));
            }

            let rc = ff::av_hwframe_transfer_data(self.staging, frame.as_ptr(), 0);
            if rc < 0 {
                bail!("reading the frame back from the GPU failed: {}", av_error(rc));
            }
            (*self.staging).pts = (*frame.as_ptr()).pts;

            if self.planar.is_null() {
                return Ok(self.staging);
            }

            let rc = ff::av_frame_make_writable(self.planar);
            if rc < 0 {
                bail!("av_frame_make_writable failed: {}", av_error(rc));
            }
            self.deinterleave()
                .context("converting NV12 to planar chroma failed")?;
            (*self.planar).pts = (*self.staging).pts;

            Ok(self.planar)
        }
    }

    pub fn format(&self) -> ff::AVPixelFormat {
        self.format
    }

    unsafe fn deinterleave(&mut self) -> Result<()> {
        let source = &*self.staging;
        let target = &*self.planar;

        let width = self.width as usize;
        let height = self.height as usize;
        let chroma_width = width.div_ceil(2);
        let chroma_height = height.div_ceil(2);

        if source.data[0].is_null() || source.data[1].is_null() {
            bail!("the downloaded frame has no pixel data");
        }
        if target.data[0].is_null() || target.data[1].is_null() || target.data[2].is_null() {
            bail!("the conversion frame has no pixel data");
        }

        for row in 0..height {
            std::ptr::copy_nonoverlapping(
                source.data[0].add(row * source.linesize[0] as usize),
                target.data[0].add(row * target.linesize[0] as usize),
                width,
            );
        }

        for row in 0..chroma_height {
            let interleaved =
                std::slice::from_raw_parts(source.data[1].add(row * source.linesize[1] as usize), chroma_width * 2);
            let u = std::slice::from_raw_parts_mut(
                target.data[1].add(row * target.linesize[1] as usize),
                chroma_width,
            );
            let v = std::slice::from_raw_parts_mut(
                target.data[2].add(row * target.linesize[2] as usize),
                chroma_width,
            );

            for column in 0..chroma_width {
                u[column] = interleaved[column * 2];
                v[column] = interleaved[column * 2 + 1];
            }
        }

        Ok(())
    }
}

impl Drop for Downloader {
    fn drop(&mut self) {
        unsafe {
            if !self.planar.is_null() {
                ff::av_frame_free(&mut self.planar);
            }
            if !self.staging.is_null() {
                ff::av_frame_free(&mut self.staging);
            }
        }
    }
}
