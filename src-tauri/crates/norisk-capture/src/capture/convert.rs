use std::sync::Mutex;

use anyhow::{anyhow, Context, Result};
use windows::core::Interface;
use windows::Win32::Foundation::{RECT, TRUE};
use windows::Win32::Graphics::Direct3D11::{
    D3D11_VIDEO_COLOR, D3D11_VIDEO_COLOR_0, D3D11_VIDEO_COLOR_RGBA,
    ID3D11Texture2D, ID3D11VideoContext1, ID3D11VideoDevice, ID3D11VideoProcessor,
    ID3D11VideoProcessorEnumerator, ID3D11VideoProcessorInputView,
    ID3D11VideoProcessorOutputView, D3D11_TEX2D_VPIV, D3D11_TEX2D_VPOV,
    D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE, D3D11_VIDEO_PROCESSOR_CONTENT_DESC,
    D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC, D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0,
    D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC, D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0,
    D3D11_VIDEO_PROCESSOR_STREAM, D3D11_VIDEO_USAGE_PLAYBACK_NORMAL,
    D3D11_VPIV_DIMENSION_TEXTURE2D, D3D11_VPOV_DIMENSION_TEXTURE2D,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709, DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709,
    DXGI_RATIONAL,
};

use super::device::CaptureDevice;

pub struct Converter {
    _device: CaptureDevice,
    video_device: ID3D11VideoDevice,
    video_context: ID3D11VideoContext1,
    output: (u32, u32),
    fps: u32,
    source_window: Option<windows::Win32::Foundation::HWND>,
    flip_vertical: bool,
    inner: Mutex<Option<Processor>>,
}

struct Processor {
    enumerator: ID3D11VideoProcessorEnumerator,
    processor: ID3D11VideoProcessor,
    input: (u32, u32),
    crop: Option<(i32, i32, u32, u32)>,
}

unsafe impl Send for Converter {}
unsafe impl Sync for Converter {}

impl Converter {
    pub fn new(device: &CaptureDevice, output: (u32, u32), fps: u32) -> Result<Self> {
        Self::for_window(device, output, fps, None)
    }

    pub fn for_window(
        device: &CaptureDevice,
        output: (u32, u32),
        fps: u32,
        source_window: Option<windows::Win32::Foundation::HWND>,
    ) -> Result<Self> {
        let video_device: ID3D11VideoDevice = device
            .device
            .cast()
            .context("GPU does not expose ID3D11VideoDevice")?;
        let video_context: ID3D11VideoContext1 = device
            .context
            .cast()
            .context("GPU does not expose ID3D11VideoContext1")?;

        Ok(Self {
            _device: device.clone(),
            video_device,
            video_context,
            output,
            fps,
            source_window,
            flip_vertical: false,
            inner: Mutex::new(None),
        })
    }

    pub fn set_flip_vertical(&mut self, flip: bool) {
        self.flip_vertical = flip;
        *self.inner.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    fn build_processor(
        video_device: &ID3D11VideoDevice,
        video_context: &ID3D11VideoContext1,
        input: (u32, u32),
        crop: Option<(i32, i32, u32, u32)>,
        output: (u32, u32),
        fps: u32,
        flip_vertical: bool,
    ) -> Result<Processor> {
        let rate = DXGI_RATIONAL {
            Numerator: fps.max(1),
            Denominator: 1,
        };

        let content = D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
            InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
            InputFrameRate: rate,
            InputWidth: input.0,
            InputHeight: input.1,
            OutputFrameRate: rate,
            OutputWidth: output.0,
            OutputHeight: output.1,
            Usage: D3D11_VIDEO_USAGE_PLAYBACK_NORMAL,
        };

        let enumerator = unsafe {
            video_device
                .CreateVideoProcessorEnumerator(&content)
                .context("CreateVideoProcessorEnumerator failed")?
        };

        let processor = unsafe {
            video_device
                .CreateVideoProcessor(&enumerator, 0)
                .context("CreateVideoProcessor failed")?
        };

        unsafe {
            video_context.VideoProcessorSetStreamColorSpace1(
                &processor,
                0,
                DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709,
            );
            if flip_vertical {
                video_context.VideoProcessorSetStreamMirror(&processor, 0, true, false, true);
            }

            video_context.VideoProcessorSetOutputColorSpace1(
                &processor,
                DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709,
            );
            video_context.VideoProcessorSetStreamFrameFormat(
                &processor,
                0,
                D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
            );

            let visible = {
                let (left, top, width, height) = crop.unwrap_or((0, 0, input.0, input.1));
                let source = RECT {
                    left,
                    top,
                    right: left + width as i32,
                    bottom: top + height as i32,
                };
                video_context.VideoProcessorSetStreamSourceRect(&processor, 0, true, Some(&source));

                if crop.is_some() {
                    log::info!(
                        "Cropping the window frame away: taking {width}x{height} at {left},{top} from {}x{}",
                        input.0,
                        input.1
                    );
                }

                (width, height)
            };

            let fitted = fit_preserving_aspect(visible, output);
            if fitted != (0, 0, output.0 as i32, output.1 as i32) {
                let dest = RECT {
                    left: fitted.0,
                    top: fitted.1,
                    right: fitted.2,
                    bottom: fitted.3,
                };
                video_context.VideoProcessorSetStreamDestRect(&processor, 0, true, Some(&dest));
                video_context.VideoProcessorSetOutputBackgroundColor(
                    &processor,
                    false,
                    &D3D11_VIDEO_COLOR {
                        Anonymous: D3D11_VIDEO_COLOR_0 {
                            RGBA: D3D11_VIDEO_COLOR_RGBA {
                                R: 0.0,
                                G: 0.0,
                                B: 0.0,
                                A: 1.0,
                            },
                        },
                    },
                );
                log::debug!(
                    "Letterboxing {}x{} into {}x{}: dest rect {:?}",
                    visible.0,
                    visible.1,
                    output.0,
                    output.1,
                    fitted
                );
            }
        }

        log::debug!(
            "VideoProcessor ready: {}x{} BGRA -> {}x{} NV12",
            input.0,
            input.1,
            output.0,
            output.1
        );

        Ok(Processor {
            enumerator,
            processor,
            input,
            crop,
        })
    }

    pub fn convert(
        &self,
        source: &ID3D11Texture2D,
        content: (u32, u32),
        dst: &ID3D11Texture2D,
        dst_slice: u32,
    ) -> Result<()> {
        let source_size = if content.0 > 0 && content.1 > 0 {
            content
        } else {
            unsafe {
                let mut desc = std::mem::zeroed::<
                    windows::Win32::Graphics::Direct3D11::D3D11_TEXTURE2D_DESC,
                >();
                source.GetDesc(&mut desc);
                (desc.Width, desc.Height)
            }
        };

        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());

        let crop = self
            .source_window
            .and_then(|hwnd| super::window::content_rect(hwnd, source_size));

        let needs_rebuild = match inner.as_ref() {
            None => true,
            Some(existing) if existing.input != source_size => {
                log::info!(
                    "Source resized {}x{} -> {}x{}, rebuilding the video processor",
                    existing.input.0,
                    existing.input.1,
                    source_size.0,
                    source_size.1
                );
                true
            }
            Some(existing) if existing.crop != crop => {
                log::info!("Window frame changed, rebuilding the video processor");
                true
            }
            Some(_) => false,
        };

        if needs_rebuild {
            *inner = Some(Self::build_processor(
                &self.video_device,
                &self.video_context,
                source_size,
                crop,
                self.output,
                self.fps,
                self.flip_vertical,
            )?);
        }

        let processor = inner
            .as_ref()
            .ok_or_else(|| anyhow!("the video processor was not built"))?;

        let input_view = self.input_view(processor, source)?;
        let output_view = self.output_view(processor, dst, dst_slice)?;

        let stream = D3D11_VIDEO_PROCESSOR_STREAM {
            Enable: TRUE,
            OutputIndex: 0,
            InputFrameOrField: 0,
            PastFrames: 0,
            FutureFrames: 0,
            ppPastSurfaces: std::ptr::null_mut(),
            pInputSurface: std::mem::ManuallyDrop::new(Some(input_view)),
            ppFutureSurfaces: std::ptr::null_mut(),
            ppPastSurfacesRight: std::ptr::null_mut(),
            pInputSurfaceRight: std::mem::ManuallyDrop::new(None),
            ppFutureSurfacesRight: std::ptr::null_mut(),
        };

        let result = unsafe {
            self.video_context
                .VideoProcessorBlt(&processor.processor, &output_view, 0, &[stream])
        };

        result.context("VideoProcessorBlt failed")
    }

    fn input_view(
        &self,
        inner: &Processor,
        texture: &ID3D11Texture2D,
    ) -> Result<ID3D11VideoProcessorInputView> {
        let desc = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
            FourCC: 0,
            ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
            Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 {
                Texture2D: D3D11_TEX2D_VPIV {
                    MipSlice: 0,
                    ArraySlice: 0,
                },
            },
        };

        let mut view = None;
        unsafe {
            self.video_device
                .CreateVideoProcessorInputView(texture, &inner.enumerator, &desc, Some(&mut view))
                .context("CreateVideoProcessorInputView failed")?;
        }
        view.ok_or_else(|| anyhow!("CreateVideoProcessorInputView returned nothing"))
    }

    fn output_view(
        &self,
        inner: &Processor,
        texture: &ID3D11Texture2D,
        slice: u32,
    ) -> Result<ID3D11VideoProcessorOutputView> {
        let desc = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
            ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
            Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 {
                Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 },
            },
        };

        let desc = if slice == 0 {
            desc
        } else {
            use windows::Win32::Graphics::Direct3D11::{
                D3D11_TEX2D_ARRAY_VPOV, D3D11_VPOV_DIMENSION_TEXTURE2DARRAY,
            };
            D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
                ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2DARRAY,
                Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 {
                    Texture2DArray: D3D11_TEX2D_ARRAY_VPOV {
                        MipSlice: 0,
                        FirstArraySlice: slice,
                        ArraySize: 1,
                    },
                },
            }
        };

        let mut view = None;
        unsafe {
            self.video_device
                .CreateVideoProcessorOutputView(texture, &inner.enumerator, &desc, Some(&mut view))
                .context("CreateVideoProcessorOutputView failed")?;
        }
        view.ok_or_else(|| anyhow!("CreateVideoProcessorOutputView returned nothing"))
    }
}

fn fit_preserving_aspect(input: (u32, u32), output: (u32, u32)) -> (i32, i32, i32, i32) {
    if input.0 == 0 || input.1 == 0 || output.0 == 0 || output.1 == 0 {
        return (0, 0, output.0 as i32, output.1 as i32);
    }

    let scale = f64::min(
        output.0 as f64 / input.0 as f64,
        output.1 as f64 / input.1 as f64,
    );

    let mut width = ((input.0 as f64 * scale).round() as u32).min(output.0) & !1;
    let mut height = ((input.1 as f64 * scale).round() as u32).min(output.1) & !1;

    const SNAP: u32 = 2;
    if output.0 - width <= SNAP {
        width = output.0;
    }
    if output.1 - height <= SNAP {
        height = output.1;
    }

    let left = ((output.0 - width) / 2) as i32;
    let top = ((output.1 - height) / 2) as i32;

    (left, top, left + width as i32, top + height as i32)
}

pub fn fit_output(source: (u32, u32), cap: (u32, u32)) -> (u32, u32) {
    if source.0 == 0 || source.1 == 0 || cap.0 == 0 || cap.1 == 0 {
        return (cap.0.max(2) & !1, cap.1.max(2) & !1);
    }

    let scale = f64::min(
        1.0,
        f64::min(
            cap.0 as f64 / source.0 as f64,
            cap.1 as f64 / source.1 as f64,
        ),
    );

    let width = ((source.0 as f64 * scale).round() as u32).max(2) & !1;
    let height = ((source.1 as f64 * scale).round() as u32).max(2) & !1;

    (width, height)
}

#[cfg(test)]
mod tests {
    use super::fit_preserving_aspect;

    use super::fit_output;

    #[test]
    fn a_windowed_game_gets_its_own_ratio_not_the_presets() {
        assert_eq!(fit_output((1920, 1007), (1920, 1080)), (1920, 1006));
    }

    #[test]
    fn a_larger_source_is_scaled_down_to_the_cap() {
        assert_eq!(fit_output((2560, 1440), (1920, 1080)), (1920, 1080));
        assert_eq!(fit_output((3840, 2160), (1280, 720)), (1280, 720));
    }

    #[test]
    fn a_smaller_source_is_left_alone() {
        assert_eq!(fit_output((854, 480), (1920, 1080)), (854, 480));
    }

    #[test]
    fn extents_are_always_even() {
        for source in [(1921, 1007), (1003, 777), (33, 17)] {
            let (w, h) = fit_output(source, (1920, 1080));
            assert_eq!(w % 2, 0, "width {w} from {source:?} is odd");
            assert_eq!(h % 2, 0, "height {h} from {source:?} is odd");
        }
    }

    #[test]
    fn the_result_never_exceeds_the_cap() {
        for source in [(3840, 1080), (1080, 3840), (5000, 5000), (1920, 1007)] {
            let (w, h) = fit_output(source, (1920, 1080));
            assert!(w <= 1920 && h <= 1080, "{source:?} produced {w}x{h}");
        }
    }

    #[test]
    fn a_degenerate_source_falls_back_to_the_cap() {
        assert_eq!(fit_output((0, 0), (1920, 1080)), (1920, 1080));
    }

    #[test]
    fn fitting_the_output_leaves_nothing_to_letterbox() {
        for source in [(1920, 1007), (2560, 1440), (854, 480), (1600, 900)] {
            let out = fit_output(source, (1920, 1080));
            let (left, top, right, bottom) = super::fit_preserving_aspect(source, out);
            assert_eq!(
                (left, top, right, bottom),
                (0, 0, out.0 as i32, out.1 as i32),
                "{source:?} -> {out:?} should fill the frame"
            );
        }
    }

    #[test]
    fn a_matching_aspect_fills_the_frame() {
        assert_eq!(
            fit_preserving_aspect((1920, 1080), (1920, 1080)),
            (0, 0, 1920, 1080)
        );
        assert_eq!(
            fit_preserving_aspect((2560, 1440), (1920, 1080)),
            (0, 0, 1920, 1080)
        );
    }

    #[test]
    fn a_wider_source_gets_bars_top_and_bottom() {
        let (left, top, right, bottom) = fit_preserving_aspect((1936, 1048), (1920, 1080));
        assert_eq!((left, right), (0, 1920), "should span the full width");
        assert!(top > 0 && bottom < 1080, "should be letterboxed");
        assert_eq!(top, (1080 - (bottom - top)) / 2, "should be centred");
    }

    #[test]
    fn a_taller_source_gets_bars_left_and_right() {
        let (left, top, right, bottom) = fit_preserving_aspect((1000, 1000), (1920, 1080));
        assert_eq!((top, bottom), (0, 1080), "should span the full height");
        assert!(left > 0 && right < 1920, "should be pillarboxed");
        assert_eq!(left, (1920 - (right - left)) / 2, "should be centred");
    }

    #[test]
    fn extents_stay_even_for_nv12_chroma() {
        for source in [(1001, 999), (1937, 1049), (333, 777)] {
            let (left, top, right, bottom) = fit_preserving_aspect(source, (1920, 1080));
            assert_eq!((right - left) % 2, 0, "odd width for {source:?}");
            assert_eq!((bottom - top) % 2, 0, "odd height for {source:?}");
        }
    }

    #[test]
    fn a_degenerate_size_falls_back_to_the_full_frame() {
        assert_eq!(fit_preserving_aspect((0, 0), (1920, 1080)), (0, 0, 1920, 1080));
    }
}
