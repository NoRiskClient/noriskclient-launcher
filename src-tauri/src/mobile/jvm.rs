use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use jni::objects::{JString, JValue};
use jni::sys as jsys;
use libloading::os::unix::{Library, RTLD_GLOBAL, RTLD_NOW};
use log::{debug, info, warn};
use std::ffi::{c_void, CString};
use std::path::{Path, PathBuf};
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::Duration;

/// A JVM can only be created once per process (JNI_CreateJavaVM after a
/// destroy is unsupported by HotSpot). Guard so a second boot attempt fails
/// with a clear message instead of undefined behavior.
static VM_CREATED: AtomicBool = AtomicBool::new(false);

pub fn vm_already_created() -> bool {
    VM_CREATED.load(Ordering::SeqCst)
}

/// dlopen all runtime libraries with RTLD_GLOBAL so that later loads (and
/// the JVM's own System.loadLibrary calls) can resolve their symbols.
/// Brute-force rounds instead of a dependency graph: libs whose DT_NEEDED
/// deps aren't loaded yet simply fail and get retried next round.
unsafe fn preload_libs(runtime: &Path) {
    let mut pending: Vec<PathBuf> = Vec::new();
    for dir in [runtime.join("lib"), runtime.join("lib/server")] {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("so") {
                    pending.push(path);
                }
            }
        }
    }

    for round in 0..8 {
        if pending.is_empty() {
            break;
        }
        let mut failed = Vec::new();
        for path in pending {
            match Library::open(Some(&path), RTLD_NOW | RTLD_GLOBAL) {
                Ok(lib) => {
                    debug!("[MobileJVM] loaded {:?}", path.file_name());
                    std::mem::forget(lib);
                }
                Err(_) => failed.push(path),
            }
        }
        pending = failed;
        debug!("[MobileJVM] preload round {}: {} unresolved", round, pending.len());
    }

    for path in &pending {
        warn!("[MobileJVM] could not preload {:?}", path.file_name());
    }
}

type CreateJavaVmFn = unsafe extern "system" fn(
    *mut *mut jsys::JavaVM,
    *mut *mut c_void,
    *mut c_void,
) -> jsys::jint;

/// Creates the process-wide JVM with the given -D/-X options and returns the
/// raw JNIEnv of the calling thread. Must be called from the thread that will
/// drive Java code; the thread must stay alive.
pub unsafe fn create_vm(runtime: &Path, extra_options: Vec<String>) -> Result<*mut jsys::JNIEnv> {
    if VM_CREATED.swap(true, Ordering::SeqCst) {
        return Err(AppError::Other(
            "A JVM was already created in this process - restart the app first".to_string(),
        ));
    }

    info!("[MobileJVM] Booting JVM from {:?}", runtime);

    let tmp_dir = LAUNCHER_DIRECTORY.meta_dir().join("tmp");
    let _ = std::fs::create_dir_all(&tmp_dir);
    let home = std::env::var("HOME").unwrap_or_else(|_| "/data/local/tmp".to_string());

    std::env::set_var("JAVA_HOME", runtime);
    std::env::set_var(
        "LD_LIBRARY_PATH",
        format!(
            "{}:{}",
            runtime.join("lib").display(),
            runtime.join("lib/server").display()
        ),
    );

    preload_libs(runtime);

    let jvm_path = runtime.join("lib/server/libjvm.so");
    let jvm_lib = Library::open(Some(&jvm_path), RTLD_NOW | RTLD_GLOBAL)
        .map_err(|e| AppError::Other(format!("dlopen libjvm.so failed: {}", e)))?;
    let create_fn: libloading::os::unix::Symbol<CreateJavaVmFn> = jvm_lib
        .get(b"JNI_CreateJavaVM")
        .map_err(|e| AppError::Other(format!("JNI_CreateJavaVM symbol missing: {}", e)))?;

    let mut option_strings: Vec<CString> = vec![
        CString::new(format!("-Djava.io.tmpdir={}", tmp_dir.display())).unwrap(),
        CString::new(format!("-Duser.home={}", home)).unwrap(),
    ];
    for opt in &extra_options {
        match CString::new(opt.as_str()) {
            Ok(c) => option_strings.push(c),
            Err(_) => warn!("[MobileJVM] Skipping option with NUL byte: {}", opt),
        }
    }
    for opt in &option_strings {
        debug!("[MobileJVM] JVM option: {:?}", opt);
    }

    let mut options: Vec<jsys::JavaVMOption> = option_strings
        .iter()
        .map(|s| jsys::JavaVMOption {
            optionString: s.as_ptr() as *mut _,
            extraInfo: null_mut(),
        })
        .collect();

    let mut args = jsys::JavaVMInitArgs {
        version: jsys::JNI_VERSION_1_8,
        nOptions: options.len() as jsys::jint,
        options: options.as_mut_ptr(),
        ignoreUnrecognized: jsys::JNI_TRUE,
    };

    let mut vm_ptr: *mut jsys::JavaVM = null_mut();
    let mut env_ptr: *mut c_void = null_mut();
    info!("[MobileJVM] Calling JNI_CreateJavaVM...");
    let rc = create_fn(&mut vm_ptr, &mut env_ptr, &mut args as *mut _ as *mut c_void);
    if rc != jsys::JNI_OK || vm_ptr.is_null() || env_ptr.is_null() {
        return Err(AppError::Other(format!(
            "JNI_CreateJavaVM failed with code {}",
            rc
        )));
    }
    std::mem::forget(jvm_lib);
    info!("[MobileJVM] JVM created successfully");

    Ok(env_ptr as *mut jsys::JNIEnv)
}

/// Boots the JVM in-process from the given runtime dir and returns
/// `java.version` as a smoke test. The JVM stays alive afterwards.
pub fn boot_and_probe(runtime: PathBuf) -> Result<String> {
    let (tx, rx) = mpsc::channel();
    std::thread::Builder::new()
        .name("nrc-jvm-main".to_string())
        .stack_size(8 * 1024 * 1024)
        .spawn(move || {
            let result = unsafe { probe_inner(&runtime) };
            let _ = tx.send(result);
            // Keep the creating thread (the JVM "main" thread) alive.
            loop {
                std::thread::park();
            }
        })
        .map_err(|e| AppError::Other(format!("Failed to spawn JVM thread: {}", e)))?;

    rx.recv_timeout(Duration::from_secs(120))
        .map_err(|_| AppError::Other("JVM boot timed out after 120s".to_string()))?
}

unsafe fn probe_inner(runtime: &Path) -> Result<String> {
    let env_ptr = create_vm(
        runtime,
        vec!["-Xmx512M".to_string(), "-XX:+UseSerialGC".to_string()],
    )?;

    let mut env = jni::JNIEnv::from_raw(env_ptr)
        .map_err(|e| AppError::Other(format!("JNIEnv wrap failed: {}", e)))?;

    let system = env
        .find_class("java/lang/System")
        .map_err(|e| AppError::Other(format!("find_class System failed: {}", e)))?;
    let key = env
        .new_string("java.version")
        .map_err(|e| AppError::Other(format!("new_string failed: {}", e)))?;
    let value = env
        .call_static_method(
            system,
            "getProperty",
            "(Ljava/lang/String;)Ljava/lang/String;",
            &[JValue::Object(&key)],
        )
        .map_err(|e| AppError::Other(format!("System.getProperty call failed: {}", e)))?
        .l()
        .map_err(|e| AppError::Other(format!("getProperty result not an object: {}", e)))?;

    let version: String = env
        .get_string(&JString::from(value))
        .map_err(|e| AppError::Other(format!("get_string failed: {}", e)))?
        .into();

    info!("[MobileJVM] java.version = {}", version);
    Ok(version)
}
