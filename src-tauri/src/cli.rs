//! CLI dispatch for the launcher.
//!
//! Two entry points:
//!   * [`dispatch_cold_start`] — called once from `main()`'s `setup()` hook.
//!     Sees the args this process itself was started with.
//!   * [`dispatch_hot_start`] — called from the `tauri-plugin-single-instance`
//!     callback with argv forwarded from a *second* invocation of the binary.
//!
//! Both go through `tauri-plugin-cli`'s `matches()` / `matches_from(argv)` —
//! the subcommand schema lives once in `tauri.conf.json`.

use crate::commands::profile_command::{
    launch_profile_with_overrides, launch_temp_profile, LaunchOverrides, TempLaunchArgs,
};
use crate::state::state_manager::State;
use log::{error, info};
use tauri::AppHandle;
use tauri_plugin_cli::{CliExt, SubcommandMatches};

/// Quick-play target parsed from `--world` / `--server`. Mutually exclusive —
/// Minecraft can only do one per launch.
#[derive(Default, Clone)]
struct QuickPlay {
    /// `--world`: join this singleplayer world. → quick_play_singleplayer
    world: Option<String>,
    /// `--server`: connect to this server address. → quick_play_multiplayer
    server: Option<String>,
}

impl QuickPlay {
    fn from_matches(sub: &SubcommandMatches) -> Result<Self, String> {
        let world = arg_str(sub, "world");
        let server = arg_str(sub, "server");
        if world.is_some() && server.is_some() {
            return Err("--world and --server are mutually exclusive".into());
        }
        Ok(Self { world, server })
    }
}

/// Parsed `launch` subcommand, lifted out of tauri-plugin-cli's `Matches` map.
struct LaunchArgs {
    profile: String,
    overrides: LaunchOverrides,
    quick_play: QuickPlay,
    local_mods: Vec<String>,
    account: Option<String>,
}

impl LaunchArgs {
    fn from_matches(sub: &SubcommandMatches) -> Result<Self, String> {
        let profile = arg_str(sub, "profile")
            .ok_or_else(|| "--profile is required".to_string())?;
        Ok(Self {
            profile,
            overrides: LaunchOverrides {
                game_version: arg_str(sub, "mc"),
                loader: arg_str(sub, "loader"),
                loader_version: arg_str(sub, "loader-version"),
                pack: arg_str(sub, "pack"),
            },
            quick_play: QuickPlay::from_matches(sub)?,
            local_mods: arg_list(sub, "mods"),
            account: arg_str(sub, "account"),
        })
    }
}

impl TempLaunchArgs {
    fn from_matches(sub: &SubcommandMatches) -> Result<Self, String> {
        let game_version = arg_str(sub, "mc").ok_or_else(|| "--mc is required".to_string())?;
        let loader = arg_str(sub, "loader").ok_or_else(|| "--loader is required".to_string())?;
        let qp = QuickPlay::from_matches(sub)?;
        Ok(Self {
            game_version,
            loader,
            loader_version: arg_str(sub, "loader-version"),
            pack: arg_str(sub, "pack"),
            name: arg_str(sub, "name"),
            quick_play_singleplayer: qp.world,
            quick_play_multiplayer: qp.server,
            local_mods: arg_list(sub, "mods"),
            account: arg_str(sub, "account"),
        })
    }
}

fn arg_str(sub: &SubcommandMatches, name: &str) -> Option<String> {
    sub.matches
        .args
        .get(name)
        .and_then(|a| a.value.as_str())
        .map(String::from)
}

/// Comma-separated multi-value arg → trimmed, non-empty parts.
fn arg_list(sub: &SubcommandMatches, name: &str) -> Vec<String> {
    arg_str(sub, name)
        .map(|s| {
            s.split(',')
                .map(|p| p.trim().to_string())
                .filter(|p| !p.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// Cold-start dispatch. Returns `true` if the app should short-circuit GUI
/// startup (e.g. after printing `version`).
pub fn dispatch_cold_start(app: &AppHandle) -> bool {
    let matches = match app.cli().matches() {
        Ok(m) => m,
        Err(_) => return false,
    };
    let Some(sub) = matches.subcommand else {
        return false;
    };

    match sub.name.as_str() {
        "version" => {
            println!("nrc-launcher {}", env!("CARGO_PKG_VERSION"));
            app.exit(0);
            true
        }
        "launch" => {
            match LaunchArgs::from_matches(&sub) {
                Ok(args) => spawn_dispatch_after_state_init(
                    app.clone(),
                    DispatchAction::Launch(args),
                    "cold",
                ),
                Err(e) => error!("[CLI cold] launch: {}", e),
            }
            false
        }
        "temp" => {
            match TempLaunchArgs::from_matches(&sub) {
                Ok(args) => spawn_dispatch_after_state_init(
                    app.clone(),
                    DispatchAction::Temp(args),
                    "cold",
                ),
                Err(e) => error!("[CLI cold] temp: {}", e),
            }
            false
        }
        other => {
            info!(
                "[CLI cold] unknown subcommand '{}', falling through to GUI",
                other
            );
            false
        }
    }
}

/// Hot-start dispatch (called from the single-instance callback). Returns
/// `true` if argv was consumed by a CLI subcommand — caller should then skip
/// the default window-focus behavior.
pub fn dispatch_hot_start(app: &AppHandle, argv: Vec<String>) -> bool {
    let Ok(matches) = app.cli().matches_from(argv) else {
        return false;
    };
    let Some(sub) = matches.subcommand else {
        return false;
    };

    let action = match sub.name.as_str() {
        "launch" => match LaunchArgs::from_matches(&sub) {
            Ok(a) => DispatchAction::Launch(a),
            Err(e) => {
                error!("[CLI hot] launch: {}", e);
                return false;
            }
        },
        "temp" => match TempLaunchArgs::from_matches(&sub) {
            Ok(a) => DispatchAction::Temp(a),
            Err(e) => {
                error!("[CLI hot] temp: {}", e);
                return false;
            }
        },
        _ => return false,
    };

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        run_action(action, "hot").await;
        let _ = app_handle;
    });
    true
}

/// Action picked up by either dispatch path.
enum DispatchAction {
    Launch(LaunchArgs),
    Temp(TempLaunchArgs),
}

async fn run_action(action: DispatchAction, tag: &'static str) {
    match action {
        DispatchAction::Launch(a) => {
            match launch_profile_with_overrides(
                a.profile,
                a.overrides,
                a.quick_play.world,
                a.quick_play.server,
                a.local_mods,
                a.account,
            )
            .await
            {
                Ok(_) => info!("[CLI {}] Launch dispatched.", tag),
                Err(e) => error!("[CLI {}] Launch failed: {:?}", tag, e),
            }
        }
        DispatchAction::Temp(a) => match launch_temp_profile(a).await {
            Ok(_) => info!("[CLI {}] Temp launch dispatched.", tag),
            Err(e) => error!("[CLI {}] Temp launch failed: {:?}", tag, e),
        },
    }
}

/// Cold-start path: state initialization happens asynchronously in a separate
/// setup-task. We poll until `State::get()` succeeds *and* the ProfileManager
/// has its profiles loaded — `State::init` resolves Phase 1 before
/// `on_state_ready` reads `profiles.json`, so `State::get().is_ok()` alone
/// returns too early for the `launch` flow. (For `temp` we don't strictly need
/// profiles loaded, but waiting is harmless — same poll keeps the code one
/// path.)
fn spawn_dispatch_after_state_init(app: AppHandle, action: DispatchAction, tag: &'static str) {
    tauri::async_runtime::spawn(async move {
        // Poll up to 60s (100ms × 600).
        for _ in 0..600 {
            if let Ok(state) = State::get().await {
                if let Ok(profiles) = state.profile_manager.list_profiles().await {
                    if !profiles.is_empty() {
                        break;
                    }
                }
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
        run_action(action, tag).await;
        // Keep the AppHandle alive for the duration of the async task so the
        // app doesn't tear down before install_minecraft_version's own spawn
        // gets going.
        let _ = app;
    });
}
