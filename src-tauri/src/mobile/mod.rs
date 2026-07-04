//! Android-only: run Minecraft Java in-process, PojavLauncher-style.
//!
//! Android has no system JVM and forbids exec() from app storage, so the
//! JVM (a Pojav/Zalith android-openjdk build) is dlopen'ed into the app
//! process and started via JNI_CreateJavaVM.

pub mod jvm;
pub mod launch;
pub mod runtime;
pub mod surface;
