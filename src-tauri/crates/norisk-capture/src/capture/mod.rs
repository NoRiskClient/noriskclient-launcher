pub mod convert;
pub mod device;
pub mod flip;
pub mod hook;
pub mod screen;
pub mod shared;
pub mod system;
pub mod wgc;
pub mod window;

pub use convert::{fit_output, Converter};
pub use device::CaptureDevice;
pub use shared::{describe, open_shared_texture};
pub use wgc::{BgraFrame, CaptureSession, CaptureStats, FrameSink};
pub use window::{find_by_pid, GameWindow, WindowState};

pub(crate) fn utf16_to_string(buffer: &[u16]) -> String {
    let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..end])
}
