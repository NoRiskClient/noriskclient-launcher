#[cfg(target_os = "windows")]
mod occlusion;
pub mod policy;
#[cfg(target_os = "windows")]
mod webview;

use crate::commands::icon_command::minimal_user;
use crate::commands::request_context::account_ctx;
use once_cell::sync::Lazy;
pub use policy::AdRect;
use policy::{
    AdSize, AdsConfig, ClickGate, ConsentAction, ConsentMode, ADS_FLAG, ADS_WEBVIEW_LABEL,
    CONSENT_SLOT, FRIENDS_WINDOW, MAIN_WINDOW,
};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Emitter, Manager, Runtime, Url, Webview};

const MAX_SLOT_EDGE: f64 = 10_000.0;
const WINDOW_POLL: Duration = Duration::from_millis(250);

fn is_sane(rect: &AdRect) -> bool {
    [rect.x, rect.y, rect.width, rect.height]
        .iter()
        .all(|v| v.is_finite() && v.abs() <= MAX_SLOT_EDGE)
        && rect.width >= 1.0
        && rect.height >= 1.0
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
enum Plan {
    Remove,
    Hide,
    Show {
        url: Url,
        rect: AdRect,
        load: bool,
        from_hidden: bool,
        offscreen: bool,
        /// Window the ad view has to sit in.
        host: &'static str,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
struct WindowState {
    visible: bool,
    size: Option<(f64, f64)>,
    occluded: bool,
    focused: bool,
}

/// What the watcher last saw of each window that can host a slot.
type Windows = BTreeMap<&'static str, WindowState>;

#[derive(Default)]
struct Ads {
    config: Option<AdsConfig>,
    norisk_plus: Option<bool>,
    slots: BTreeMap<String, AdRect>,
    covered: BTreeSet<String>,
    windows: Windows,
    /// See [`policy::pick_slot`].
    active_slot: Option<String>,
    loaded_url: Option<Url>,
    page_ready: bool,
    last_load: Option<Instant>,
    pending_consent: bool,
    reload_waiting: bool,
    fresh_load: bool,
    clicks: ClickGate,
    consent: ConsentMode,
    launcher_opened_dialog: bool,
    managed_from_prompt: bool,
    dialog_loading: bool,
    personalized: Option<bool>,
    hidden: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdsStatus {
    pub personalized: Option<bool>,
    pub consent: ConsentMode,
}

impl Ads {
    fn active(&self) -> bool {
        policy::shows_ads(self.config.as_ref(), self.norisk_plus, std::env::consts::OS)
    }

    fn window(&self, label: &str) -> WindowState {
        self.windows.get(label).copied().unwrap_or_default()
    }

    fn choose(&self, windows: &Windows) -> Option<String> {
        let on_screen = |slot: &&str| {
            windows
                .get(policy::slot_window(slot))
                .is_some_and(|window| window.visible)
        };
        let candidates: Vec<&str> = self.slots.keys().map(String::as_str).filter(on_screen).collect();
        let focused = windows.iter().find(|(_, window)| window.focused).map(|(label, _)| *label);
        policy::pick_slot(&candidates, focused, self.active_slot.as_deref()).map(str::to_string)
    }

    fn pick(&mut self) -> bool {
        let picked = self.choose(&self.windows);
        std::mem::replace(&mut self.active_slot, picked) != self.active_slot
    }

    /// The privacy dialog always opens over the launcher.
    fn host(&self) -> &'static str {
        if self.consent == ConsentMode::Dialog {
            return MAIN_WINDOW;
        }
        self.active_slot.as_deref().map(policy::slot_window).unwrap_or(MAIN_WINDOW)
    }

    /// Where the ad view would sit, for the occlusion check.
    fn probe(&self, windows: &Windows) -> Option<(&'static str, AdRect)> {
        if self.consent == ConsentMode::Dialog {
            return Some((MAIN_WINDOW, consent_spot(windows)?));
        }
        let slot = self.choose(windows)?;
        let rect = *self.slots.get(&slot)?;
        Some((policy::slot_window(&slot), rect))
    }

    fn slot_covered(&self) -> bool {
        self.active_slot.as_ref().is_some_and(|slot| self.covered.contains(slot))
    }

    fn target(&self, config: &AdsConfig) -> Option<(Url, AdRect)> {
        if !self.window(self.host()).visible {
            return None;
        }
        if self.consent == ConsentMode::Dialog {
            let rect = consent_spot(&self.windows)?;
            return config.ad_url(CONSENT_SLOT).map(|url| (url, rect));
        }
        let name = self.active_slot.as_ref()?;
        let rect = self.slots.get(name)?;
        config.ad_url(name).map(|url| (url, *rect))
    }

    fn plan(&mut self, now: Instant) -> Plan {
        self.pick();
        let mut plan = self.next_plan(now);
        let was_hidden = std::mem::replace(&mut self.hidden, !matches!(plan, Plan::Show { .. }));
        if let Plan::Show { from_hidden, .. } = &mut plan {
            *from_hidden = was_hidden;
        }
        plan
    }

    fn next_plan(&mut self, now: Instant) -> Plan {
        self.reload_waiting = false;
        let Some(config) = self.config.clone().filter(|_| self.active()) else {
            self.unload();
            return Plan::Remove;
        };
        let hidden = match self.consent {
            ConsentMode::Prompt => true,
            ConsentMode::Dialog => false,
            ConsentMode::Closed => self.window(self.host()).occluded || self.slot_covered(),
        };
        if hidden {
            return Plan::Hide;
        }
        let Some((url, rect)) = self.target(&config) else {
            self.pending_consent = false;
            return Plan::Hide;
        };
        let host = self.host();
        if self.loaded_url.as_ref() == Some(&url) && !self.fresh_load {
            return Plan::Show { url, rect, load: false, from_hidden: false, offscreen: self.dialog_loading, host };
        }
        let delay = if self.consent != ConsentMode::Closed || self.pending_consent || self.fresh_load {
            Duration::ZERO
        } else {
            policy::reload_delay(self.last_load, now)
        };
        if delay.is_zero() {
            self.loaded_url = Some(url.clone());
            self.last_load = Some(now);
            self.fresh_load = false;
            self.page_ready = false;
            self.dialog_loading = self.consent == ConsentMode::Dialog;
            self.pending_consent |= self.dialog_loading;
            return Plan::Show { url, rect, load: true, from_hidden: false, offscreen: self.dialog_loading, host };
        }
        self.reload_waiting = true;
        let stand_in = self
            .loaded_url
            .clone()
            .filter(|loaded| self.page_ready && !self.fresh_load && policy::same_ad_size(loaded, &url));
        if let Some(loaded) = stand_in {
            // Moved to a same-size slot before the reload interval is over: the loaded page
            // stands in until the right placement may load.
            return Plan::Show { url: loaded, rect, load: false, from_hidden: false, offscreen: false, host };
        }
        Plan::Hide
    }

    fn needs_apply(&mut self, windows: Windows, now: Instant) -> bool {
        let changed = self.windows != windows;
        self.windows = windows;
        let moved = self.pick();
        let reload_due =
            self.reload_waiting && policy::reload_delay(self.last_load, now).is_zero();
        changed || moved || reload_due
    }

    fn unload(&mut self) {
        self.loaded_url = None;
        self.page_ready = false;
    }

    /// Returns whether the window had any slots.
    fn forget_slots_of(&mut self, window: &str) -> bool {
        let before = self.slots.len();
        self.slots.retain(|slot, _| policy::slot_window(slot) != window);
        self.covered.retain(|slot| policy::slot_window(slot) != window);
        self.slots.len() != before
    }
}

/// The privacy dialog opens centred over the launcher.
fn consent_spot(windows: &Windows) -> Option<AdRect> {
    let (width, height) = windows.get(MAIN_WINDOW)?.size?;
    Some(policy::consent_rect(width, height))
}

static ADS: Lazy<Mutex<Ads>> = Lazy::new(Mutex::default);
static APPLY: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static WATCHING: AtomicBool = AtomicBool::new(false);

fn ads() -> MutexGuard<'static, Ads> {
    ADS.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn ipc_permits<R: Runtime>(webview: &Webview<R>) -> bool {
    let page = (webview.label() == ADS_WEBVIEW_LABEL)
        .then(|| webview.url().ok())
        .flatten();
    policy::ad_page_ipc_allowed(webview.label(), page.as_ref())
}

pub fn plugin() -> TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("ads")
        .invoke_handler(crate::ipc_guard::guard(
            ipc_permits,
            tauri::generate_handler![
                crate::commands::ads_command::ad_clicked,
                crate::commands::ads_command::open_ad_link,
                crate::commands::ads_command::ad_consent_mode,
                crate::commands::ads_command::ad_privacy,
            ],
        ))
        .build()
}

async fn own_norisk_plus() -> Option<bool> {
    let me = account_ctx(None).await.ok()?.account_uuid?;
    minimal_user(&me).await.ok().map(|user| user.is_norisk_plus())
}

fn window_states<R: Runtime>(app: &AppHandle<R>) -> Windows {
    [MAIN_WINDOW, FRIENDS_WINDOW]
        .into_iter()
        .map(|label| (label, window_state(app, label)))
        .collect()
}

fn window_state<R: Runtime>(app: &AppHandle<R>, label: &str) -> WindowState {
    let Some(window) = app.get_window(label) else {
        return WindowState::default();
    };
    let visible = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(true);
    let focused = window.is_focused().unwrap_or(false);
    let size = window
        .inner_size()
        .ok()
        .zip(window.scale_factor().ok())
        .map(|(size, scale)| {
            let logical = size.to_logical::<f64>(scale);
            (logical.width, logical.height)
        });
    WindowState { visible, size, occluded: false, focused }
}

#[cfg(target_os = "windows")]
fn ad_occluded<R: Runtime>(app: &AppHandle<R>, label: &str, rect: AdRect) -> bool {
    let Some(window) = app.get_window(label) else {
        return false;
    };
    let (Ok(origin), Ok(scale), Ok(hwnd)) = (window.inner_position(), window.scale_factor(), window.hwnd()) else {
        return false;
    };
    let edge = |offset: i32, logical: f64| offset + (logical * scale).round() as i32;
    let ad = policy::ScreenRect {
        left: edge(origin.x, rect.x),
        top: edge(origin.y, rect.y),
        right: edge(origin.x, rect.x + rect.width),
        bottom: edge(origin.y, rect.y + rect.height),
    };
    policy::is_occluded(ad, &occlusion::windows_above(hwnd.0 as isize))
}

#[cfg(not(target_os = "windows"))]
fn ad_occluded<R: Runtime>(_app: &AppHandle<R>, _label: &str, _rect: AdRect) -> bool {
    false
}

pub async fn configure<R: Runtime>(app: &AppHandle<R>) -> BTreeMap<String, AdSize> {
    let config = crate::feature_flags::current()
        .await
        .value_as(ADS_FLAG)
        .and_then(AdsConfig::from_flag);
    let norisk_plus = match config {
        Some(_) => own_norisk_plus().await,
        None => None,
    };
    let windows = window_states(app);
    let (active, changed, slots) = {
        let mut state = ads();
        let changed = state.config != config;
        if changed {
            state.unload();
        }
        state.config = config;
        state.norisk_plus = norisk_plus;
        state.windows = windows;
        let active = state.active();
        let slots = match (&state.config, active) {
            (Some(config), true) => config.sizes(),
            _ => BTreeMap::new(),
        };
        (active, changed, slots)
    };
    if changed {
        let _serial = APPLY.lock().await;
        execute(app, Plan::Remove);
    }
    if active {
        watch_window(app.clone());
    }
    log::info!("[Ads] Launcher ads active: {}", active);
    apply(app).await;
    slots
}

pub async fn set_slot<R: Runtime>(app: &AppHandle<R>, slot: String, rect: AdRect) {
    if !policy::AD_SLOTS.contains(&slot.as_str()) || !is_sane(&rect) {
        return;
    }
    let changed = {
        let mut state = ads();
        let uncovered = state.covered.remove(&slot);
        let moved = state.slots.insert(slot, rect) != Some(rect);
        uncovered || moved
    };
    if changed {
        apply(app).await;
    }
}

pub async fn cover_slot<R: Runtime>(app: &AppHandle<R>, slot: &str) {
    let changed = {
        let mut state = ads();
        state.slots.contains_key(slot) && state.covered.insert(slot.to_string())
    };
    if changed {
        apply(app).await;
    }
}

pub async fn clear_slot<R: Runtime>(app: &AppHandle<R>, slot: &str) {
    let changed = {
        let mut state = ads();
        state.covered.remove(slot);
        state.slots.remove(slot).is_some()
    };
    if changed {
        apply(app).await;
    }
}

pub fn launcher_page_reloaded<R: Runtime>(app: &AppHandle<R>) {
    host_page_reloaded(app, MAIN_WINDOW);
}

/// A reloading page drops its slots until it reports them again.
pub fn host_page_reloaded<R: Runtime>(app: &AppHandle<R>, window: &str) {
    if ads().forget_slots_of(window) {
        apply_later(app);
    }
}

/// The friends window is closing: its slots go, and the ad view moves back to the launcher
/// first so it is not torn down with it. Other windows never host the ad view.
pub fn host_closing<R: Runtime>(app: &AppHandle<R>, window: &str) {
    if window != FRIENDS_WINDOW {
        return;
    }
    let had_slots = {
        let mut state = ads();
        state.windows.remove(window);
        state.forget_slots_of(window)
    };
    #[cfg(target_os = "windows")]
    {
        if !webview::rescue(app, window) {
            ads().unload();
        }
    }
    if had_slots {
        apply_later(app);
    }
}

pub async fn show_consent<R: Runtime>(app: &AppHandle<R>) {
    let ready = {
        let mut state = ads();
        if !state.active() {
            return;
        }
        state.launcher_opened_dialog = true;
        state.pending_consent = !state.page_ready;
        state.page_ready
    };
    if ready {
        eval_consent(app, None);
    }
    apply(app).await;
}

pub fn consent_action<R: Runtime>(app: &AppHandle<R>, action: ConsentAction) {
    let answer = {
        let mut state = ads();
        let prompting = state.consent == ConsentMode::Prompt;
        state.launcher_opened_dialog |= prompting && action == ConsentAction::Customize;
        state.managed_from_prompt |= prompting && action == ConsentAction::Customize;
        prompting
    };
    if answer {
        eval_consent(app, Some(action));
    }
}

pub fn page_consent_mode<R: Runtime>(app: &AppHandle<R>, mode: ConsentMode) {
    let (changed, revealed) = {
        let mut state = ads();
        if !policy::accepts_page_mode(state.consent, state.launcher_opened_dialog, mode) {
            log::warn!("[Ads] Ignored a privacy dialog the launcher did not open");
            return;
        }
        if mode != ConsentMode::Dialog {
            state.launcher_opened_dialog = false;
        }
        let revealed = std::mem::take(&mut state.dialog_loading);
        let previous = std::mem::replace(&mut state.consent, mode);
        state.fresh_load |= policy::reload_after_consent(previous, mode, state.managed_from_prompt);
        if mode == ConsentMode::Closed {
            state.managed_from_prompt = false;
        }
        (previous != mode, revealed)
    };
    if revealed && !changed {
        apply_later(app);
    }
    if changed {
        if let Err(e) = app.emit_to(crate::utils::main_window::LABEL, "ads_consent_mode", mode) {
            log::warn!("[Ads] Could not tell the launcher about the privacy dialog: {}", e);
        }
        apply_later(app);
    }
}

fn notify_launcher<R: Runtime>(app: &AppHandle<R>, event: &str) {
    if let Err(e) = app.emit_to(crate::utils::main_window::LABEL, event, ()) {
        log::warn!("[Ads] Could not tell the launcher about {}: {}", event, e);
    }
}

pub fn record_privacy<R: Runtime>(app: &AppHandle<R>, consented_purposes: &[u32]) {
    let personalized = Some(policy::personalized_ads(consented_purposes));
    let changed = {
        let mut state = ads();
        std::mem::replace(&mut state.personalized, personalized) != personalized
    };
    if changed {
        notify_launcher(app, "ads_status_changed");
    }
}

pub fn status() -> AdsStatus {
    let state = ads();
    AdsStatus {
        personalized: state.personalized,
        consent: state.consent,
    }
}

pub fn record_click() {
    ads().clicks.record_click(Instant::now());
}

pub fn admit_link<R: Runtime>(app: &AppHandle<R>, url: &str) -> Option<Url> {
    let host = ads().host();
    let focused = app
        .get_window(host)
        .is_some_and(|w| w.is_focused().unwrap_or(false));
    ads().clicks.admit(url, Instant::now(), focused)
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn page_ready<R: Runtime>(app: &AppHandle<R>) -> bool {
    let (reopen, lost) = {
        let mut state = ads();
        state.page_ready = true;
        let reopen = std::mem::take(&mut state.pending_consent);
        let lost = policy::dialog_lost_on_load(state.consent, reopen);
        if lost {
            state.dialog_loading = false;
            state.consent = ConsentMode::Closed;
            state.launcher_opened_dialog = false;
        }
        (reopen, lost)
    };
    if lost {
        if let Err(e) = app.emit_to(crate::utils::main_window::LABEL, "ads_consent_mode", ConsentMode::Closed) {
            log::warn!("[Ads] Could not tell the launcher about the privacy dialog: {}", e);
        }
        apply_later(app);
    }
    reopen
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn page_left() {
    let mut state = ads();
    state.unload();
    state.reload_waiting = true;
}

fn apply_later<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move { apply(&app).await });
}

async fn apply<R: Runtime>(app: &AppHandle<R>) {
    let _serial = APPLY.lock().await;
    let plan = ads().plan(Instant::now());
    execute(app, plan);
}

fn watch_window<R: Runtime>(app: AppHandle<R>) {
    if WATCHING.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(WINDOW_POLL);
        loop {
            ticker.tick().await;
            let mut windows = window_states(&app);
            let probe = ads().probe(&windows);
            if let Some((host, rect)) = probe {
                if let Some(window) = windows.get_mut(host) {
                    window.occluded = window.visible && ad_occluded(&app, host, rect);
                }
            }
            let due = ads().needs_apply(windows, Instant::now());
            if due {
                apply(&app).await;
            }
        }
    });
}

#[cfg(target_os = "windows")]
use webview::{eval_consent, execute};

#[cfg(not(target_os = "windows"))]
fn execute<R: Runtime>(_app: &AppHandle<R>, _plan: Plan) {}

#[cfg(not(target_os = "windows"))]
fn eval_consent<R: Runtime>(_app: &AppHandle<R>, _action: Option<ConsentAction>) {}
