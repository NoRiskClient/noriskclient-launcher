pub mod mix;

#[cfg(windows)]
pub mod decoder;
#[cfg(windows)]
pub mod encoder;
#[cfg(windows)]
pub mod wasapi;

pub use mix::{MixedBlock, Mixer, Track};

#[cfg(windows)]
pub use decoder::AudioDecoder;
#[cfg(windows)]
pub use encoder::AudioEncoder;
#[cfg(windows)]
pub use wasapi::{AudioDevice, AudioFormat, AudioSource, LoopbackCapture};

pub const MIX_LABEL: &str = "Mix";

pub const MIC_LABEL: &str = "Microphone";

pub const GAME_LABEL: &str = "Game";
