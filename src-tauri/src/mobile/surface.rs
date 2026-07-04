use crate::error::{AppError, Result};
use jni::sys::{jclass, jobject, JNIEnv as RawJNIEnv};
use libloading::os::unix::{Library, Symbol, RTLD_GLOBAL, RTLD_NOW};
use log::{info, warn};
use std::path::PathBuf;
use std::time::Duration;

fn natives_dir() -> PathBuf {
    PathBuf::from("/data/data/gg.norisk.NoRiskClientLauncherV3/files/natives-android")
}

/// `void Java_..._ZLBridge_setupBridgeWindow(JNIEnv*, jclass, jobject surface)`
type SetupBridgeWindowFn = unsafe extern "C" fn(*mut RawJNIEnv, jclass, jobject);

/// Shows the ART game SurfaceView and binds its Surface to libpojavexec's
/// window bridge, so the in-process Minecraft JVM renders onto it.
///
/// Key trick: we never `System.loadLibrary` libpojavexec on the ART side (its
/// JNI_OnLoad demands Zalith's whole bridge layer). A plain `dlopen` here does
/// NOT run JNI_OnLoad but exposes the exported `setupBridgeWindow` symbol; the
/// guest JVM later loads the same file (RTLD_GLOBAL, same path → same instance,
/// shared window global) via LWJGL, which does run JNI_OnLoad against the
/// guest-side CallbackBridge.
pub fn bind_game_surface() -> Result<()> {
    // Load the native lib so the setupBridgeWindow symbol resolves. Order
    // matters: libpojavexec NEEDs libdriver_helper.
    let dir = natives_dir();
    unsafe {
        // System EGL/GLES must be globally resolvable before gl4es loads
        // (eglMakeCurrent etc.); libvulkan is needed for the Zink backend.
        for sys in [
            "/system/lib64/libEGL.so",
            "/system/lib64/libGLESv2.so",
            "/system/lib64/libGLESv3.so",
            "/system/lib64/libvulkan.so",
        ] {
            let _ = Library::open(Some(std::path::Path::new(sys)), RTLD_NOW | RTLD_GLOBAL);
        }
        let _ = Library::open(Some(dir.join("libdriver_helper.so")), RTLD_NOW | RTLD_GLOBAL);
    }
    let pojav = unsafe {
        Library::open(Some(dir.join("libpojavexec.so")), RTLD_NOW | RTLD_GLOBAL)
            .map_err(|e| AppError::Other(format!("dlopen libpojavexec failed: {}", e)))?
    };
    let setup: Symbol<SetupBridgeWindowFn> = unsafe {
        pojav
            .get(b"Java_com_movtery_zalithlauncher_bridge_ZLBridge_setupBridgeWindow")
            .map_err(|e| AppError::Other(format!("setupBridgeWindow symbol missing: {}", e)))?
    };
    // Keep the handle alive for the process lifetime.
    std::mem::forget(pojav);

    // Attach the ART JVM (Android's, not the guest JVM).
    let ctx = ndk_context::android_context();
    if ctx.vm().is_null() {
        return Err(AppError::Other("Android JavaVM pointer is null".to_string()));
    }
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|e| AppError::Other(format!("JavaVM::from_raw failed: {}", e)))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| AppError::Other(format!("attach_current_thread failed: {}", e)))?;

    // A native (attached) thread's default FindClass uses the system class
    // loader, which can't see app dex classes. Resolve GameBridge through the
    // activity's class loader instead.
    let activity = unsafe { jni::objects::JObject::from_raw(ctx.context().cast()) };
    let loader = env
        .call_method(&activity, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])
        .and_then(|v| v.l())
        .map_err(|e| AppError::Other(format!("getClassLoader failed: {}", e)))?;
    let name = env
        .new_string("gg.norisk.NoRiskClientLauncherV3.GameBridge")
        .map_err(|e| AppError::Other(format!("new_string failed: {}", e)))?;
    let class_obj = env
        .call_method(
            &loader,
            "loadClass",
            "(Ljava/lang/String;)Ljava/lang/Class;",
            &[(&name).into()],
        )
        .and_then(|v| v.l())
        .map_err(|e| AppError::Other(format!("loadClass GameBridge failed: {}", e)))?;
    let game_bridge = jni::objects::JClass::from(class_obj);

    // Show the SurfaceView.
    env.call_static_method(&game_bridge, "requestGameSurfaceFromNative", "()V", &[])
        .map_err(|e| AppError::Other(format!("requestGameSurfaceFromNative failed: {}", e)))?;

    // Poll until the surface is created (surfaceCreated callback on the UI thread).
    let mut surface = None;
    for _ in 0..100 {
        let s = env
            .call_static_method(&game_bridge, "getSurface", "()Landroid/view/Surface;", &[])
            .and_then(|v| v.l());
        if let Ok(obj) = s {
            if !obj.is_null() {
                surface = Some(obj);
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    let surface = surface
        .ok_or_else(|| AppError::Other("Game surface not ready after 5s".to_string()))?;

    // Hand the Surface to the native bridge using the ART JNIEnv (where the
    // Surface object lives). jclass is unused by the impl → pass null.
    unsafe {
        setup(env.get_raw(), std::ptr::null_mut(), surface.as_raw());
    }

    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_describe();
        let _ = env.exception_clear();
        warn!("[MobileSurface] Java exception during setupBridgeWindow");
    }

    info!("[MobileSurface] Game surface bound to native window bridge");
    Ok(())
}
