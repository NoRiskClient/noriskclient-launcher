use tauri::ipc::Invoke;
use tauri::{Runtime, Webview};

pub const MINECRAFT_SIGN_IN_LABEL: &str = "signin";
pub const DISCORD_SIGN_IN_LABEL: &str = "discord-signin";
pub const GITHUB_SIGN_IN_LABEL: &str = "github-signin";
pub const REMOTE_SIGN_IN_LABELS: &[&str] = &[
    MINECRAFT_SIGN_IN_LABEL,
    DISCORD_SIGN_IN_LABEL,
    GITHUB_SIGN_IN_LABEL,
];

pub fn allows(webview_label: &str) -> bool {
    !REMOTE_SIGN_IN_LABELS.contains(&webview_label)
}

pub fn launcher_permits<R: Runtime>(webview: &Webview<R>) -> bool {
    allows(webview.label())
}

pub fn guard<R, P, F>(permits: P, handler: F) -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static
where
    R: Runtime,
    P: Fn(&Webview<R>) -> bool + Send + Sync + 'static,
    F: Fn(Invoke<R>) -> bool + Send + Sync + 'static,
{
    move |invoke: Invoke<R>| {
        let webview = invoke.message.webview_ref();
        let command = invoke.message.command();
        if permits(webview) {
            return handler(invoke);
        }
        log::warn!(
            "[IPC] Blocked command '{}' from webview '{}'",
            command,
            webview.label()
        );
        invoke.resolver.reject("Command not allowed");
        true
    }
}
