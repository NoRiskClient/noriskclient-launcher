use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use norisk_ipc::CaptureState;
use windows::core::{IInspectable, Interface};
use windows::Foundation::{EventRegistrationToken, TypedEventHandler};
use windows::Graphics::Capture::{
    Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession,
};
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Graphics::SizeInt32;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Direct3D11::ID3D11Texture2D;
use windows::Win32::System::WinRT::Direct3D11::IDirect3DDxgiInterfaceAccess;
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;

use super::device::CaptureDevice;
use super::window::{self, WindowState};

const FRAME_POOL_SIZE: i32 = 3;
const STALL_THRESHOLD: Duration = Duration::from_millis(1200);

pub struct BgraFrame<'a> {
    pub texture: &'a ID3D11Texture2D,
    pub width: u32,
    pub height: u32,
    pub timestamp_100ns: i64,
}

pub trait FrameSink: Send + Sync + 'static {
    fn on_frame(&self, frame: BgraFrame<'_>);
}

impl<F> FrameSink for F
where
    F: Fn(BgraFrame<'_>) + Send + Sync + 'static,
{
    fn on_frame(&self, frame: BgraFrame<'_>) {
        self(frame)
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub struct CaptureStats {
    pub received: u64,
    pub delivered: u64,
    pub gated: u64,
    pub size_changes: u64,
}

struct Inner {
    device: CaptureDevice,
    sink: Box<dyn FrameSink>,
    min_interval_100ns: i64,
    last_delivered_100ns: AtomicI64,
    last_frame_nanos: AtomicU64,
    started: Instant,
    received: AtomicU64,
    delivered: AtomicU64,
    gated: AtomicU64,
    size_changes: AtomicU64,
    current_size: Mutex<SizeInt32>,
}

unsafe impl Send for Inner {}
unsafe impl Sync for Inner {}

pub struct CaptureSession {
    hwnd: HWND,
    inner: Arc<Inner>,
    pool: Direct3D11CaptureFramePool,
    session: GraphicsCaptureSession,
    frame_arrived: EventRegistrationToken,
    pub border_disabled: bool,
}

impl CaptureSession {
    pub fn start(
        device: CaptureDevice,
        hwnd: HWND,
        target_fps: u32,
        sink: impl FrameSink,
    ) -> Result<Self> {
        let interop: IGraphicsCaptureItemInterop =
            windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
                .context("GraphicsCaptureItem interop factory unavailable")?;
        let item: GraphicsCaptureItem = unsafe {
            interop
                .CreateForWindow(hwnd)
                .context("CreateForWindow failed")?
        };

        let size = item.Size().context("capture item has no size")?;

        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &device.winrt_device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            FRAME_POOL_SIZE,
            size,
        )
        .context("CreateFreeThreaded frame pool failed")?;

        let inner = Arc::new(Inner {
            device,
            sink: Box::new(sink),
            min_interval_100ns: if target_fps == 0 {
                0
            } else {
                (10_000_000 / target_fps as i64) * 9 / 10
            },
            last_delivered_100ns: AtomicI64::new(i64::MIN),
            last_frame_nanos: AtomicU64::new(0),
            started: Instant::now(),
            received: AtomicU64::new(0),
            delivered: AtomicU64::new(0),
            gated: AtomicU64::new(0),
            size_changes: AtomicU64::new(0),
            current_size: Mutex::new(size),
        });

        let handler_inner = Arc::clone(&inner);
        let frame_arrived = pool
            .FrameArrived(&TypedEventHandler::<
                Direct3D11CaptureFramePool,
                IInspectable,
            >::new(move |sender, _| {
                if let Some(pool) = sender.as_ref() {
                    handler_inner.on_frame_arrived(pool);
                }
                Ok(())
            }))
            .context("subscribing to FrameArrived failed")?;

        let session = pool
            .CreateCaptureSession(&item)
            .context("CreateCaptureSession failed")?;

        let _ = session.SetIsCursorCaptureEnabled(false);
        let border_disabled = session.SetIsBorderRequired(false).is_ok();

        session.StartCapture().context("StartCapture failed")?;

        log::info!(
            "Capture started: {}x{} @ target {} fps, border {}",
            size.Width,
            size.Height,
            target_fps,
            if border_disabled { "hidden" } else { "forced by OS" }
        );

        Ok(Self {
            hwnd,
            inner,
            pool,
            session,
            frame_arrived,
            border_disabled,
        })
    }

    pub fn stats(&self) -> CaptureStats {
        CaptureStats {
            received: self.inner.received.load(Ordering::Relaxed),
            delivered: self.inner.delivered.load(Ordering::Relaxed),
            gated: self.inner.gated.load(Ordering::Relaxed),
            size_changes: self.inner.size_changes.load(Ordering::Relaxed),
        }
    }

    pub fn window_state(&self) -> WindowState {
        window::state_of(self.hwnd)
    }

    pub fn window_pid(&self) -> u32 {
        window::pid_of(self.hwnd)
    }

    pub fn state(&self) -> CaptureState {
        let window = self.window_state();
        if !window.alive {
            return CaptureState::Failed;
        }
        if !window.should_produce_frames() {
            return CaptureState::Buffering;
        }

        let since_last = self.since_last_frame();
        if since_last > STALL_THRESHOLD {
            return CaptureState::BlockedFullscreenExclusive;
        }

        CaptureState::Buffering
    }

    fn since_last_frame(&self) -> Duration {
        let nanos = self.inner.last_frame_nanos.load(Ordering::Relaxed);
        let elapsed = self.inner.started.elapsed();
        if nanos == 0 {
            return elapsed;
        }
        elapsed.saturating_sub(Duration::from_nanos(nanos))
    }

    pub fn adapter(&self) -> &str {
        &self.inner.device.adapter_name
    }
}

impl Drop for CaptureSession {
    fn drop(&mut self) {
        let _ = self.session.Close();
        let _ = self.pool.RemoveFrameArrived(self.frame_arrived);
        let _ = self.pool.Close();
    }
}

impl Inner {
    fn on_frame_arrived(&self, pool: &Direct3D11CaptureFramePool) {
        let frame = match pool.TryGetNextFrame() {
            Ok(frame) => frame,
            Err(e) if e.code().is_ok() => return,
            Err(e) => {
                log::warn!("TryGetNextFrame failed: {e}");
                return;
            }
        };

        self.received.fetch_add(1, Ordering::Relaxed);

        if let Err(e) = self.handle(pool, &frame) {
            log::warn!("Dropping frame: {e:#}");
        }

        let _ = frame.Close();
    }

    fn handle(
        &self,
        pool: &Direct3D11CaptureFramePool,
        frame: &windows::Graphics::Capture::Direct3D11CaptureFrame,
    ) -> Result<()> {
        let content = frame.ContentSize().context("frame has no content size")?;

        {
            let mut current = self
                .current_size
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            if content.Width != current.Width || content.Height != current.Height {
                log::info!(
                    "Window resized {}x{} -> {}x{}, recreating frame pool",
                    current.Width,
                    current.Height,
                    content.Width,
                    content.Height
                );
                pool.Recreate(
                    &self.device.winrt_device,
                    DirectXPixelFormat::B8G8R8A8UIntNormalized,
                    FRAME_POOL_SIZE,
                    content,
                )
                .context("frame pool Recreate failed")?;
                *current = content;
                self.size_changes.fetch_add(1, Ordering::Relaxed);
            }
        }

        let timestamp = frame
            .SystemRelativeTime()
            .context("frame has no timestamp")?
            .Duration;

        let last = self.last_delivered_100ns.load(Ordering::Relaxed);
        if last != i64::MIN && timestamp.saturating_sub(last) < self.min_interval_100ns {
            self.gated.fetch_add(1, Ordering::Relaxed);
            return Ok(());
        }
        self.last_delivered_100ns.store(timestamp, Ordering::Relaxed);
        self.last_frame_nanos.store(
            self.started.elapsed().as_nanos() as u64,
            Ordering::Relaxed,
        );

        let surface = frame.Surface().context("frame has no surface")?;
        let access: IDirect3DDxgiInterfaceAccess = surface
            .cast()
            .context("surface does not expose IDirect3DDxgiInterfaceAccess")?;
        let texture: ID3D11Texture2D =
            unsafe { access.GetInterface() }.context("surface is not an ID3D11Texture2D")?;

        self.sink.on_frame(BgraFrame {
            texture: &texture,
            width: content.Width.max(0) as u32,
            height: content.Height.max(0) as u32,
            timestamp_100ns: timestamp,
        });
        self.delivered.fetch_add(1, Ordering::Relaxed);

        Ok(())
    }
}
