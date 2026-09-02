pub mod convert;
pub mod device;
pub mod hook;
pub mod shared;
pub mod wgc;
pub mod window;

pub use convert::{fit_output, Converter};
pub use device::CaptureDevice;
pub use shared::{describe, open_shared_texture};
pub use wgc::{BgraFrame, CaptureSession, CaptureStats, FrameSink};
pub use window::{find_by_pid, GameWindow, WindowState};
