#[cfg(not(windows))]
fn main() {
    eprintln!("The capture engine is Windows-only.");
    std::process::exit(1);
}

#[cfg(windows)]
fn main() -> anyhow::Result<()> {
    use norisk_capture::{engine::Engine, ipc};
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    let args: Vec<String> = std::env::args().collect();

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

    if let Some(dir) = log_dir {
        let setup = norisk_logging::LogSetup::new(dir, "capture.log")
            .level(log::LevelFilter::Debug)
            .console(false);
        if let Err(e) = norisk_logging::init(setup) {
            eprintln!("Could not set up logging: {e}");
        }
    }

    log::info!(
        "norisk-capture {} starting on {pipe_name}",
        env!("CARGO_PKG_VERSION")
    );

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }

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
            Ok(())
        }
        Err(e) => {
            log::error!("IPC failed: {e:#}");
            Err(e)
        }
    }
}
