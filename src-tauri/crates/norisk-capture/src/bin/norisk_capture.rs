#[cfg(not(any(windows, target_os = "macos")))]
fn main() {
    eprintln!("The capture engine is Windows-only.");
    std::process::exit(1);
}

#[cfg(windows)]
fn main() -> anyhow::Result<()> {
    use norisk_capture::{engine::Engine, ipc, watchdog};
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    let args: Vec<String> = std::env::args().collect();

    if let Some((thread_id, dll)) = norisk_capture::capture::hook::injector_request(&args) {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        return norisk_capture::capture::hook::run_injector(thread_id, &dll);
    }

    let pipe_name = args
        .iter()
        .position(|a| a == "--pipe")
        .and_then(|i| args.get(i + 1))
        .cloned()
        .ok_or_else(|| {
            anyhow::anyhow!("--pipe is required; this process is started by the launcher")
        })?;

    let log_dir = args
        .iter()
        .position(|a| a == "--log-dir")
        .and_then(|i| args.get(i + 1))
        .map(std::path::PathBuf::from);

    let parent_pid = args
        .iter()
        .position(|a| a == "--parent-pid")
        .and_then(|i| args.get(i + 1))
        .and_then(|pid| pid.parse::<u32>().ok());

    if let Some(dir) = log_dir {
        let setup = norisk_logging::LogSetup::new(dir, "capture.log")
            .level(log::LevelFilter::Debug)
            .console(false);
        if let Err(e) = norisk_logging::init(setup) {
            eprintln!("Could not set up logging: {e}");
        }
    }

    std::panic::set_hook(Box::new(|info| {
        let trace = std::backtrace::Backtrace::force_capture();
        log::error!("The capture engine crashed: {info}\n{trace}");
        log::logger().flush();
    }));

    log::info!(
        "norisk-capture {} starting on {pipe_name}",
        env!("CARGO_PKG_VERSION")
    );

    match parent_pid {
        Some(pid) => watchdog::watch_parent(pid),
        None => log::warn!("Started without --parent-pid, so nothing will notice if the launcher dies"),
    }

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }

    see_real_pixels();

    let (commands_tx, commands_rx) = std::sync::mpsc::channel();
    let (events_tx, events_rx) = tokio::sync::mpsc::unbounded_channel();

    let engine = std::thread::Builder::new()
        .name("nrc-engine".into())
        .spawn(move || Engine::new(events_tx).run(commands_rx))?;

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;

    let result = runtime.block_on(ipc::serve(&pipe_name, commands_tx, events_rx));

    let _ = engine.join();

    match result {
        Ok(()) => {
            log::info!("norisk-capture exiting cleanly");
            watchdog::leave(0)
        }
        Err(e) => {
            log::error!("IPC failed: {e:#}");
            watchdog::leave(1)
        }
    }
}

#[cfg(target_os = "macos")]
fn main() {
    norisk_capture::macos::run();
}

#[cfg(windows)]
fn see_real_pixels() {
    use windows::Win32::UI::HiDpi::{
        SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
    };

    if let Err(e) = unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) } {
        log::warn!(
            "Could not ask Windows for real pixel sizes, so window sizes on a scaled display will be off: {e}"
        );
    }
}
