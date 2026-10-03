use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};

use windows::Win32::Graphics::Direct3D11::ID3D11Texture2D;

use super::session::{HookSession, HookTexture};
use crate::capture::wgc::{BgraFrame, FrameSink};
use crate::capture::{shared, CaptureDevice};

pub struct HookCapture {
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
    stats: Arc<Stats>,
    adapter: String,
    pid: u32,
}

#[derive(Default)]
struct Stats {
    delivered: std::sync::atomic::AtomicU64,
    reopened: std::sync::atomic::AtomicU64,
}

impl HookCapture {
    pub fn start(
        device: CaptureDevice,
        session: HookSession,
        texture: HookTexture,

        fps: u32,
        sink: impl FrameSink,
    ) -> Result<Self> {
        let opened = shared::open_shared_texture(&device.device, texture.handle)
            .context("could not open the hook's texture")?;
        let staging = create_processor_input(&device, &opened)
            .context("could not create the video processor's input texture")?;

        let stop = Arc::new(AtomicBool::new(false));
        let stats = Arc::new(Stats::default());
        let adapter = device.adapter_name.clone();
        let pid = session.pid();

        let thread = {
            let stop = Arc::clone(&stop);
            let stats = Arc::clone(&stats);
            std::thread::Builder::new()
                .name("nrc-hook-capture".into())
                .spawn(move || {
                    run(device, session, opened, staging, texture, fps, sink, stop, stats)
                })
                .context("could not start the hook capture thread")?
        };

        Ok(Self {
            stop,
            thread: Some(thread),
            stats,
            adapter,
            pid,
        })
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    pub fn frames_delivered(&self) -> u64 {
        self.stats.delivered.load(Ordering::Relaxed)
    }

    pub fn adapter(&self) -> &str {
        &self.adapter
    }

    pub fn has_stopped(&self) -> bool {
        self.thread.as_ref().is_none_or(|thread| thread.is_finished())
    }
}

impl Drop for HookCapture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn run(
    device: CaptureDevice,
    session: HookSession,
    mut opened: ID3D11Texture2D,
    mut staging: ID3D11Texture2D,
    mut texture: HookTexture,
    fps: u32,
    sink: impl FrameSink,
    stop: Arc<AtomicBool>,
    stats: Arc<Stats>,
) {
    let interval = if fps == 0 {
        Duration::from_millis(16)
    } else {
        Duration::from_nanos(1_000_000_000 / fps as u64)
    };

    let mut next = Instant::now();
    let mut size = texture_size(&staging);
    let mut unopenable_since: Option<Instant> = None;

    while !stop.load(Ordering::Relaxed) {
        let now = Instant::now();
        if now < next {
            std::thread::sleep(next - now);
        }
        next += interval;
        let now = Instant::now();
        if next < now {
            next = now;
        }

        match session.refresh_texture(texture.map_id) {
            Ok(Some(fresh)) => {
                match shared::open_shared_texture(&device.device, fresh.handle)
                    .and_then(|t| create_processor_input(&device, &t).map(|s| (t, s)))
                {
                    Ok((new_texture, new_staging)) => {
                        log::info!(
                            "Hook replaced its texture: {}x{} -> {}x{}",
                            texture.width,
                            texture.height,
                            fresh.width,
                            fresh.height
                        );
                        opened = new_texture;
                        staging = new_staging;
                        size = texture_size(&staging);
                        texture = fresh;
                        unopenable_since = None;
                        stats.reopened.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(e) => {
                        let since = *unopenable_since.get_or_insert_with(|| {
                            log::warn!("Could not open the hook's new texture: {e:#}");
                            Instant::now()
                        });
                        if since.elapsed() > GIVE_UP_AFTER {
                            log::warn!(
                                "The hook's texture has not opened for {GIVE_UP_AFTER:?}; stopping so the recording can be rebuilt"
                            );
                            break;
                        }
                        continue;
                    }
                }
            }
            Ok(_) => {}
            Err(e) => {
                log::warn!("Lost contact with the hook: {e:#}");
                break;
            }
        }

        unsafe {
            device.context.CopyResource(&staging, &opened);
        }

        sink.on_frame(BgraFrame {
            texture: &staging,
            width: size.0,
            height: size.1,
            timestamp_100ns: qpc_100ns(),
        });
        stats.delivered.fetch_add(1, Ordering::Relaxed);
    }

    log::info!(
        "Hook capture stopped after {} frames",
        stats.delivered.load(Ordering::Relaxed)
    );
}

fn create_processor_input(
    device: &CaptureDevice,
    source: &ID3D11Texture2D,
) -> Result<ID3D11Texture2D> {
    use windows::Win32::Graphics::Direct3D11::{
        D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE, D3D11_TEXTURE2D_DESC,
    };

    let mut desc = D3D11_TEXTURE2D_DESC::default();
    unsafe { source.GetDesc(&mut desc) };

    let desc = D3D11_TEXTURE2D_DESC {
        Format: readable(desc.Format),
        BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
        MiscFlags: 0,
        CPUAccessFlags: 0,
        ..desc
    };

    let mut texture = None;
    unsafe {
        device
            .device
            .CreateTexture2D(&desc, None, Some(&mut texture))
            .context("CreateTexture2D failed")?;
    }
    texture.context("CreateTexture2D returned nothing")
}

const GIVE_UP_AFTER: Duration = Duration::from_secs(3);

fn texture_size(texture: &ID3D11Texture2D) -> (u32, u32) {
    let desc = shared::describe(texture);
    (desc.Width, desc.Height)
}

fn readable(
    format: windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT,
) -> windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT {
    use windows::Win32::Graphics::Dxgi::Common::*;

    match format {
        DXGI_FORMAT_B8G8R8A8_TYPELESS | DXGI_FORMAT_B8G8R8A8_UNORM_SRGB => {
            DXGI_FORMAT_B8G8R8A8_UNORM
        }
        DXGI_FORMAT_R8G8B8A8_TYPELESS | DXGI_FORMAT_R8G8B8A8_UNORM_SRGB => {
            DXGI_FORMAT_R8G8B8A8_UNORM
        }
        DXGI_FORMAT_R10G10B10A2_TYPELESS => DXGI_FORMAT_R10G10B10A2_UNORM,
        DXGI_FORMAT_R16G16B16A16_TYPELESS => DXGI_FORMAT_R16G16B16A16_FLOAT,
        other => other,
    }
}

fn qpc_100ns() -> i64 {
    use std::sync::OnceLock;
    use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};

    static FREQUENCY: OnceLock<i64> = OnceLock::new();
    let frequency = *FREQUENCY.get_or_init(|| {
        let mut frequency = 0i64;
        unsafe {
            let _ = QueryPerformanceFrequency(&mut frequency);
        }
        frequency
    });
    if frequency == 0 {
        return 0;
    }

    let mut counter = 0i64;
    unsafe {
        let _ = QueryPerformanceCounter(&mut counter);
    }
    (counter as i128 * 10_000_000 / frequency as i128) as i64
}
