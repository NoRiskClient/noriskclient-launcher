use super::policy::{self, ADS_USER_AGENT, ADS_WEBVIEW_LABEL};
use super::{AdRect, Plan};
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Runtime, Url, Webview, WebviewUrl, Window};

const CLICK_BRIDGE: &str = include_str!("click_bridge.js");

fn blank() -> Url {
    Url::parse("about:blank").expect("about:blank is a valid url")
}

pub(super) fn execute<R: Runtime>(app: &AppHandle<R>, plan: Plan) {
    if let Err(e) = try_execute(app, plan) {
        log::warn!("[Ads] Could not update the ad view: {}", e);
    }
}

fn try_execute<R: Runtime>(app: &AppHandle<R>, plan: Plan) -> tauri::Result<()> {
    let move_id = MOVES.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    let existing = app.get_webview(ADS_WEBVIEW_LABEL);
    match plan {
        Plan::Remove => {
            if let Some(webview) = existing {
                webview.close()?;
            }
        }
        Plan::Hide => {
            if let Some(webview) = existing {
                park(&webview)?;
            }
        }
        Plan::Show { url, rect, load, from_hidden, offscreen, host } => {
            let host_window = app.get_window(host).ok_or(tauri::Error::WindowNotFound)?;
            let mut moved = false;
            let had_view = existing.is_some();
            let webview = match existing {
                Some(webview) => {
                    if webview.window().label() != host {
                        webview.reparent(&host_window)?;
                        moved = true;
                    }
                    if load {
                        webview.navigate(url)?;
                    }
                    webview
                }
                None => create(&host_window, rect, url)?,
            };
            // A hidden or just moved view can flash its last frame: repaint off screen first.
            let stale_frame = had_view && (from_hidden || moved);
            webview.set_size(LogicalSize::new(rect.width, rect.height))?;
            if offscreen {
                webview.set_position(OFFSCREEN)?;
                webview.show()?;
            } else if stale_frame {
                webview.set_position(OFFSCREEN)?;
                webview.show()?;
                let target = webview.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(REPAINT_DELAY).await;
                    if MOVES.load(std::sync::atomic::Ordering::SeqCst) != move_id {
                        return;
                    }
                    if let Err(e) = target.set_position(LogicalPosition::new(rect.x, rect.y)) {
                        log::warn!("[Ads] Could not move the ad view into place: {}", e);
                    }
                });
            } else {
                webview.set_position(LogicalPosition::new(rect.x, rect.y))?;
                webview.show()?;
            }
        }
    }
    Ok(())
}

const OFFSCREEN: LogicalPosition<f64> = LogicalPosition { x: -10_000.0, y: -10_000.0 };
const REPAINT_DELAY: std::time::Duration = std::time::Duration::from_millis(120);
static MOVES: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn park<R: Runtime>(webview: &Webview<R>) -> tauri::Result<()> {
    webview.hide()?;
    webview.set_position(OFFSCREEN)
}

/// Parks the ad view in the launcher before its window closes. Returns whether a view is left.
pub(super) fn rescue<R: Runtime>(app: &AppHandle<R>, closing: &str) -> bool {
    let Some(webview) = app.get_webview(ADS_WEBVIEW_LABEL) else {
        return false;
    };
    if webview.window().label() != closing {
        return true;
    }
    let moved = app
        .get_window(policy::MAIN_WINDOW)
        .ok_or(tauri::Error::WindowNotFound)
        .and_then(|main| webview.reparent(&main))
        .and_then(|_| park(&webview));
    match moved {
        Ok(()) => true,
        Err(e) => {
            log::warn!("[Ads] Could not move the ad view out of a closing window: {}", e);
            false
        }
    }
}

pub(super) fn eval_consent<R: Runtime>(app: &AppHandle<R>, action: Option<super::ConsentAction>) {
    let Some(webview) = app.get_webview(ADS_WEBVIEW_LABEL) else {
        return;
    };
    let call = match action {
        Some(action) => format!("perform(\"{}\")", action.page_name()),
        None => "reopen()".to_string(),
    };
    if let Err(e) = webview.eval(format!("window.__nrcConsent && window.__nrcConsent.{call};")) {
        log::warn!("[Ads] Could not reach the ad privacy dialog: {}", e);
    }
}

fn page_loaded<R: Runtime>(webview: &Webview<R>, url: &Url) {
    if policy::is_ad_origin(url) {
        if super::page_ready(webview.app_handle()) {
            eval_consent(webview.app_handle(), None);
        }
        return;
    }
    if url.scheme() == "about" {
        return;
    }
    log::warn!("[Ads] Ad view left the ad page, unloading it");
    super::page_left();
    let _ = webview.navigate(blank());
}

fn create<R: Runtime>(
    window: &Window<R>,
    rect: AdRect,
    url: Url,
) -> tauri::Result<Webview<R>> {
    let app = window.app_handle();
    let mut builder = WebviewBuilder::new(ADS_WEBVIEW_LABEL, WebviewUrl::External(blank()))
        .initialization_script_for_all_frames(CLICK_BRIDGE)
        .on_navigation(policy::navigation_allowed)
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_download(|_, _| false)
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Finished {
                page_loaded(&webview, payload.url());
            }
        })
        .transparent(true)
        .focused(false)
        .disable_drag_drop_handler()
        .zoom_hotkeys_enabled(false)
        .user_agent(ADS_USER_AGENT);
    builder = builder.data_directory(app.path().app_local_data_dir()?.join("ads-webview"));
    let webview = window.add_child(
        builder,
        LogicalPosition::new(rect.x, rect.y),
        LogicalSize::new(rect.width, rect.height),
    )?;
    prepare_engine(&webview, url);
    Ok(webview)
}

fn prepare_engine<R: Runtime>(webview: &Webview<R>, url: Url) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Profile3, ICoreWebView2_13, ICoreWebView2_8,
        COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_NONE,
    };
    use windows_core::{Interface, HSTRING};

    let result = webview.with_webview(move |platform| unsafe {
        let core = platform.controller().CoreWebView2();
        if let Err(e) = core.clone().and_then(|core| core.cast::<ICoreWebView2_8>()).and_then(|core| core.SetIsMuted(true)) {
            log::warn!("[Ads] Could not mute the ad view: {}", e);
        }
        let applied = core
            .and_then(|core| core.cast::<ICoreWebView2_13>())
            .and_then(|core| core.Profile())
            .and_then(|profile| profile.cast::<ICoreWebView2Profile3>())
            .and_then(|profile| {
                profile.SetPreferredTrackingPreventionLevel(
                    COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_NONE,
                )
            });
        if let Err(e) = applied {
            log::warn!("[Ads] Could not turn tracking prevention off: {}", e);
        }
        let navigated = platform
            .controller()
            .CoreWebView2()
            .and_then(|core| core.Navigate(&HSTRING::from(url.as_str())));
        if let Err(e) = navigated {
            log::warn!("[Ads] Could not load the ad page: {}", e);
        }
    });
    if let Err(e) = result {
        log::warn!("[Ads] Could not reach the ad view engine: {}", e);
    }
}
