pub mod buffer;

pub mod audio;
#[cfg(windows)]
pub mod capture;
#[cfg(windows)]
pub mod encoder;
#[cfg(windows)]
pub mod fault;
#[cfg(windows)]
pub mod engine;
#[cfg(windows)]
pub mod ipc;
#[cfg(windows)]
pub mod gif;
#[cfg(windows)]
pub mod overlay;
#[cfg(windows)]
pub mod trim;
#[cfg(windows)]
pub mod preview;
#[cfg(windows)]
pub mod render;
pub mod watchdog;
#[cfg(windows)]
pub mod writer;

#[cfg(target_os = "macos")]
pub mod macos;
