use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use jni::objects::{JObject, JValue};
use log::{error, info, warn};
use std::path::PathBuf;

/// App-internal files dir (adb-pushed artifacts for the PoC; later downloaded).
fn files_dir() -> PathBuf {
    PathBuf::from("/data/data/gg.norisk.NoRiskClientLauncherV3/files")
}

/// Directory with the Pojav/Zalith LWJGL fork + Android native libs.
fn lwjgl_dir() -> PathBuf {
    files_dir().join("lwjgl3")
}

fn natives_dir() -> PathBuf {
    files_dir().join("natives-android")
}

/// Native GL backend for the in-process game. Pojav/Zalith ship several that
/// differ only in the env/JVM props the native bridge reads before boot.
/// Switchable at runtime via a `renderer` marker file next to the natives, so
/// the PoC can flip backends with an `adb push`, no rebuild.
#[derive(Clone, Copy, PartialEq)]
enum Renderer {
    /// NG-gl4es -> GLES3 through the system EGL/GLES translator. Needs a real
    /// EGL context on the game Surface, which weak emulator EGL stacks choke on.
    Gl4es,
    /// Zink: Mesa GL 4.6 over Vulkan, rendered into an OSMesa buffer and blitted
    /// to the Surface via ANativeWindow (glfwstub.initEgl=false -> no EGL context
    /// on the surface). Zalith's default; sidesteps the emulator EGL problem.
    Zink,
}

impl Renderer {
    fn resolve() -> Self {
        let marker = files_dir().join("renderer.txt");
        match std::fs::read_to_string(&marker)
            .ok()
            .map(|s| s.trim().to_lowercase())
            .as_deref()
        {
            Some("gl4es") | Some("opengles3") => Renderer::Gl4es,
            _ => Renderer::Zink,
        }
    }

    fn label(&self) -> &'static str {
        match self {
            Renderer::Gl4es => "gl4es/GLES3",
            Renderer::Zink => "vulkan_zink",
        }
    }

    /// Process-wide env read by libpojavexec via getenv before the JVM boots.
    fn apply_env(&self, native_dir: &str) {
        std::env::set_var("POJAV_NATIVEDIR", native_dir);
        std::env::set_var(
            "LD_LIBRARY_PATH",
            format!("{}:/system/lib64:/vendor/lib64", native_dir),
        );
        std::env::set_var("MESA_GLSL_CACHE_DISABLE", "true");
        match self {
            Renderer::Gl4es => {
                // NG-gl4es (opengles3) exposes GL 3.x, which MC 1.17+ needs;
                // plain gl4es only reaches GL 2.1 and dies on GL_INVALID_ENUM.
                // LIBGL_NOERROR swallows the leftover incompatible enums.
                std::env::set_var("POJAV_RENDERER", "opengles3");
                std::env::set_var("LIBGL_ES", "3");
                std::env::set_var("LIBGL_GL", "32");
                std::env::set_var("LIBGL_USE_MC_COLOR", "1");
                std::env::set_var("LIBGL_NORMALIZE", "1");
                std::env::set_var("LIBGL_NOERROR", "1");
                std::env::set_var("LIBGL_MIPMAP", "3");
                std::env::set_var("LIBGL_NOINTOVLHACK", "1");
                std::env::set_var("LIBGL_GLES", "/system/lib64/libGLESv2.so");
                std::env::set_var("LIBGL_EGL", "/system/lib64/libEGL.so");
            }
            Renderer::Zink => {
                std::env::set_var("POJAV_RENDERER", "vulkan_zink");
                std::env::set_var("MESA_LOADER_DRIVER_OVERRIDE", "zink");
                std::env::set_var("MESA_GL_VERSION_OVERRIDE", "4.6");
                std::env::set_var("MESA_GLSL_VERSION_OVERRIDE", "460");
                std::env::set_var("LIB_MESA_NAME", format!("{}/libOSMesa_8.so", native_dir));
            }
        }
    }

    /// LWJGL/GLFW-stub JVM props: pick the GL provider lib + (for Zink) turn
    /// off EGL so the bridge uses the ANativeWindow blit path.
    fn jvm_props(&self, native_dir: &str) -> Vec<String> {
        let mut p = vec![
            format!("-Dorg.lwjgl.librarypath={}", native_dir),
            format!("-Dorg.lwjgl.freetype.libname={}/libfreetype.so", native_dir),
        ];
        match self {
            Renderer::Gl4es => {
                p.push(format!(
                    "-Dorg.lwjgl.opengl.libname={}/libng_gl4es.so",
                    native_dir
                ));
            }
            Renderer::Zink => {
                p.push(format!(
                    "-Dorg.lwjgl.opengl.libname={}/libOSMesa_8.so",
                    native_dir
                ));
                p.push("-Dorg.lwjgl.vulkan.libname=libvulkan.so".to_string());
                p.push("-Dglfwstub.initEgl=false".to_string());
            }
        }
        p
    }
}

/// Redirect the process stdout/stderr into a log file so JVM/Minecraft
/// output (System.out, exceptions) is inspectable. Best-effort.
fn redirect_stdio(log_path: &std::path::Path) {
    if let Some(parent) = log_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let Ok(file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    else {
        warn!("[MobileLaunch] Could not open {:?} for stdio redirect", log_path);
        return;
    };
    use std::os::fd::AsRawFd;
    unsafe {
        libc::dup2(file.as_raw_fd(), libc::STDOUT_FILENO);
        libc::dup2(file.as_raw_fd(), libc::STDERR_FILENO);
    }
    std::mem::forget(file);
    info!("[MobileLaunch] stdout/stderr redirected to {:?}", log_path);
}

/// Rewrites the desktop classpath for Android: desktop LWJGL jars are
/// replaced by the Pojav LWJGL fork (GLFW-stub/EGL backend).
fn rewrite_classpath(classpath: &str) -> String {
    let fork_jar = lwjgl_dir().join("lwjgl-glfw-classes.jar");
    let mut entries: Vec<String> = vec![fork_jar.to_string_lossy().to_string()];
    let mut dropped = 0;
    for entry in classpath.split(':') {
        let lower = entry.to_lowercase();
        if lower.contains("lwjgl") {
            dropped += 1;
            continue;
        }
        entries.push(entry.to_string());
    }
    info!(
        "[MobileLaunch] Classpath rewritten: {} desktop lwjgl entries replaced by fork jar",
        dropped
    );
    entries.join(":")
}

/// Transforms the desktop java invocation (jvm args, -cp, library paths)
/// into JNI_CreateJavaVM options suitable for the in-process Android JVM.
fn build_vm_options(jvm_args: &[String], renderer: Renderer) -> Vec<String> {
    let natives = natives_dir().to_string_lossy().to_string();
    let mut options: Vec<String> = Vec::new();
    let mut iter = jvm_args.iter().peekable();

    while let Some(arg) = iter.next() {
        if arg == "-cp" || arg == "-classpath" {
            if let Some(cp) = iter.next() {
                options.push(format!("-Djava.class.path={}", rewrite_classpath(cp)));
            }
            continue;
        }
        if arg.starts_with("-Djava.library.path=") {
            // Desktop natives are useless on Android; point at the Pojav libs.
            options.push(format!("-Djava.library.path={}", natives));
            continue;
        }
        options.push(arg.clone());
    }

    // Renderer-specific LWJGL/GLFW-stub props (GL provider lib, EGL toggle).
    options.extend(renderer.jvm_props(&natives));
    // Force JNA to load the Android libjnidispatch.so from the natives dir. The
    // guest OpenJDK reports os.name=Linux, so JNA would otherwise unpack its
    // bundled glibc build (dlopen fails: "libc.so.6 not found" on Bionic),
    // which cascades into oshi's <clinit> and kills MC before it renders.
    options.push(format!("-Djna.boot.library.path={}", natives));
    options.push(format!("-Duser.dir={}", LAUNCHER_DIRECTORY.meta_dir().display()));
    options
}

/// Launches Minecraft inside the app process: creates the JVM with the
/// transformed options and invokes `main_class.main(game_args)` on a
/// dedicated thread. Returns immediately after the launch thread starts;
/// progress lands in mc-android.log.
pub fn launch_in_process(
    jvm_args: Vec<String>,
    main_class: String,
    game_args: Vec<String>,
) -> Result<()> {
    if super::jvm::vm_already_created() {
        return Err(AppError::Other(
            "A JVM is already running in this process (JVM test?). Restart the app and launch again.".to_string(),
        ));
    }
    let runtime = super::runtime::runtime_dir();
    if !super::runtime::is_runtime_installed() {
        return Err(AppError::Other(
            "Android JRE is not installed yet - run the JVM test once first.".to_string(),
        ));
    }
    let fork_jar = lwjgl_dir().join("lwjgl-glfw-classes.jar");
    if !fork_jar.is_file() {
        return Err(AppError::Other(format!(
            "LWJGL fork jar missing at {:?} - push lwjgl3/ + natives-android/ first",
            fork_jar
        )));
    }

    let log_path = LAUNCHER_DIRECTORY.meta_dir().join("logs").join("mc-android.log");

    // Pick the GL backend (marker file, default Zink) and set the env that
    // libpojavexec reads via getenv before the JVM boots.
    let native_dir = natives_dir().to_string_lossy().to_string();
    let renderer = Renderer::resolve();
    info!("[MobileLaunch] Renderer: {}", renderer.label());
    renderer.apply_env(&native_dir);

    // Show the game SurfaceView and bind it to the native GLFW window bridge
    // before MC creates its window.
    if let Err(e) = super::surface::bind_game_surface() {
        warn!("[MobileLaunch] Could not bind game surface: {}", e);
    }

    let options = build_vm_options(&jvm_args, renderer);

    info!(
        "[MobileLaunch] Launching {} in-process with {} jvm options, {} game args",
        main_class,
        options.len(),
        game_args.len()
    );

    std::thread::Builder::new()
        .name("nrc-mc-main".to_string())
        .stack_size(16 * 1024 * 1024)
        .spawn(move || {
            redirect_stdio(&log_path);
            println!("=== NRC mc-android launch: {} ===", main_class);
            let result = unsafe { run_main(&runtime, options, &main_class, &game_args) };
            match result {
                Ok(()) => info!("[MobileLaunch] Minecraft main() returned"),
                Err(e) => error!("[MobileLaunch] Launch failed: {}", e),
            }
            loop {
                std::thread::park();
            }
        })
        .map_err(|e| AppError::Other(format!("Failed to spawn MC thread: {}", e)))?;

    Ok(())
}

unsafe fn run_main(
    runtime: &std::path::Path,
    options: Vec<String>,
    main_class: &str,
    game_args: &[String],
) -> Result<()> {
    let env_ptr = super::jvm::create_vm(runtime, options)?;
    let mut env = jni::JNIEnv::from_raw(env_ptr)
        .map_err(|e| AppError::Other(format!("JNIEnv wrap failed: {}", e)))?;

    let class_path = main_class.replace('.', "/");
    let class = match env.find_class(&class_path) {
        Ok(c) => c,
        Err(e) => {
            let _ = env.exception_describe();
            return Err(AppError::Other(format!(
                "Main class {} not found: {}",
                main_class, e
            )));
        }
    };

    let array = env
        .new_object_array(game_args.len() as i32, "java/lang/String", JObject::null())
        .map_err(|e| AppError::Other(format!("arg array alloc failed: {}", e)))?;
    for (i, arg) in game_args.iter().enumerate() {
        let jstr = env
            .new_string(arg)
            .map_err(|e| AppError::Other(format!("arg string alloc failed: {}", e)))?;
        env.set_object_array_element(&array, i as i32, jstr)
            .map_err(|e| AppError::Other(format!("arg array set failed: {}", e)))?;
    }

    info!("[MobileLaunch] Invoking {}.main()", main_class);
    let call = env.call_static_method(
        class,
        "main",
        "([Ljava/lang/String;)V",
        &[JValue::Object(&array)],
    );

    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_describe();
        let _ = env.exception_clear();
        return Err(AppError::Other(
            "Minecraft main() threw an exception (see mc-android.log)".to_string(),
        ));
    }
    call.map_err(|e| AppError::Other(format!("main() invocation failed: {}", e)))?;
    Ok(())
}
