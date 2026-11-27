use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::time::{Duration, Instant};
use url::Url;

pub const ADS_FLAG: &str = "launcher.ads";
pub const ADS_WEBVIEW_LABEL: &str = "ads";

pub fn is_ad_webview(label: &str) -> bool {
    label == ADS_WEBVIEW_LABEL
        || label
            .strip_prefix(ADS_WEBVIEW_LABEL)
            .is_some_and(|rest| rest.starts_with('-'))
}
pub const AD_SLOTS: &[&str] = &["play-news", FRIENDS_AD_SLOT];

/// The friends window's rail. Every other slot is in the main window.
pub const FRIENDS_AD_SLOT: &str = "friends-rail";

pub const MAIN_WINDOW: &str = crate::utils::main_window::LABEL;
pub const FRIENDS_WINDOW: &str = crate::utils::friends_window::LABEL;

/// The window that reports the slot and hosts the ad view while it fills it.
pub fn slot_window(slot: &str) -> &'static str {
    if slot == FRIENDS_AD_SLOT {
        FRIENDS_WINDOW
    } else {
        MAIN_WINDOW
    }
}

/// Picks the one slot the ad view fills, from slots whose window is on screen: the focused
/// window wins, else the current slot stays, else the launcher's slot comes first.
pub fn pick_slot<'a>(
    candidates: &[&'a str],
    focused_window: Option<&str>,
    current: Option<&str>,
) -> Option<&'a str> {
    if let Some(focused) = focused_window {
        if let Some(slot) = candidates.iter().find(|slot| slot_window(slot) == focused) {
            return Some(slot);
        }
    }
    if let Some(slot) = current.and_then(|current| candidates.iter().find(|slot| **slot == current)) {
        return Some(slot);
    }
    candidates
        .iter()
        .find(|slot| slot_window(slot) == MAIN_WINDOW)
        .or_else(|| candidates.first())
        .copied()
}

/// Whether two ad page urls ask for the same size, so one can stand in for the other.
pub fn same_ad_size(a: &Url, b: &Url) -> bool {
    let size = |url: &Url| url.query_pairs().find(|(key, _)| key == "size").map(|(_, value)| value.into_owned());
    size(a).is_some() && size(a) == size(b)
}
pub const CONSENT_SLOT: &str = "consent";
pub const ALLOWED_AD_SIZES: &[&str] = &["300x250", "300x600", "728x90", "320x50"];
pub const ALLOWED_AD_HOSTS: &[&str] = &["ads.norisk.gg"];
pub const CLICK_WINDOW: Duration = Duration::from_millis(1000);
pub const OPEN_INTERVAL: Duration = Duration::from_secs(2);
pub const RELOAD_INTERVAL: Duration = Duration::from_secs(30);
pub const MAX_AD_URL_LEN: usize = 2048;
pub const ADS_USER_AGENT: &str = concat!(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ",
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 NoRiskClient/",
    env!("CARGO_PKG_VERSION")
);
const MAX_PLACEMENT_LEN: usize = 40;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct AdSize {
    pub width: u32,
    pub height: u32,
}

impl AdSize {
    fn parse(value: &str) -> Option<Self> {
        if !ALLOWED_AD_SIZES.contains(&value) {
            return None;
        }
        let (width, height) = value.split_once('x')?;
        Some(Self {
            width: width.parse().ok()?,
            height: height.parse().ok()?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdSlot {
    pub placement: String,
    pub size: AdSize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdsConfig {
    pub page_url: Url,
    pub slots: BTreeMap<String, AdSlot>,
    pub dev: bool,
    pub plus_sees_ads: bool,
}

#[derive(Deserialize)]
struct RawAdSlot {
    #[serde(default)]
    enabled: bool,
    placement: String,
    size: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawAdsConfig {
    page_url: String,
    #[serde(default)]
    slots: BTreeMap<String, RawAdSlot>,
    #[serde(default)]
    dev: bool,
    #[serde(default)]
    plus_sees_ads: bool,
}

impl AdsConfig {
    pub fn from_flag(raw: RawAdsConfig) -> Option<Self> {
        let page_url = Url::parse(&raw.page_url).ok().filter(is_ad_origin)?;
        let slots: BTreeMap<String, AdSlot> = raw
            .slots
            .into_iter()
            .filter(|(name, slot)| slot.enabled && AD_SLOTS.contains(&name.as_str()))
            .filter_map(|(name, slot)| {
                let size = AdSize::parse(&slot.size)?;
                let placement = Some(slot.placement).filter(|p| is_valid_placement(p))?;
                Some((name, AdSlot { placement, size }))
            })
            .collect();
        if slots.is_empty() {
            return None;
        }
        Some(Self {
            page_url,
            slots,
            dev: raw.dev,
            plus_sees_ads: raw.plus_sees_ads,
        })
    }

    pub fn sizes(&self) -> BTreeMap<String, AdSize> {
        self.slots
            .iter()
            .map(|(name, slot)| (name.clone(), slot.size))
            .collect()
    }

    pub fn ad_url(&self, slot_name: &str) -> Option<Url> {
        let slot = if slot_name == CONSENT_SLOT {
            self.slots.values().next()?
        } else {
            self.slots.get(slot_name)?
        };
        let mut url = self.page_url.clone();
        url.set_fragment(None);
        {
            let mut query = url.query_pairs_mut();
            query
                .clear()
                .append_pair("placement", &slot.placement)
                .append_pair("size", &format!("{}x{}", slot.size.width, slot.size.height));
            if self.dev {
                query.append_pair("dev", "1");
            }
        }
        Some(url)
    }
}

fn is_valid_placement(placement: &str) -> bool {
    (1..=MAX_PLACEMENT_LEN).contains(&placement.len())
        && placement
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

pub fn is_ad_origin(url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url
            .host_str()
            .is_some_and(|host| ALLOWED_AD_HOSTS.contains(&host))
}

pub fn shows_ads(config: Option<&AdsConfig>, norisk_plus: Option<bool>, os: &str) -> bool {
    config.is_some_and(|config| config.plus_sees_ads || norisk_plus == Some(false)) && os == "windows"
}

pub fn navigation_allowed(url: &Url) -> bool {
    match url.scheme() {
        "about" => true,
        "http" | "https" => is_ad_origin(url),
        _ => false,
    }
}

pub fn ad_page_ipc_allowed(webview_label: &str, page: Option<&Url>) -> bool {
    webview_label == ADS_WEBVIEW_LABEL && page.is_some_and(is_ad_origin)
}

pub fn reload_delay(last_load: Option<Instant>, now: Instant) -> Duration {
    last_load.map_or(Duration::ZERO, |loaded| {
        RELOAD_INTERVAL.saturating_sub(now.saturating_duration_since(loaded))
    })
}

#[derive(Debug, Default)]
pub struct ClickGate {
    last_click: Option<Instant>,
    last_open: Option<Instant>,
}

impl ClickGate {
    pub fn record_click(&mut self, now: Instant) {
        self.last_click = Some(now);
    }

    pub fn admit(&mut self, url: &str, now: Instant, launcher_focused: bool) -> Option<Url> {
        if !launcher_focused || url.len() > MAX_AD_URL_LEN {
            return None;
        }
        let url = Url::parse(url)
            .ok()
            .filter(|u| matches!(u.scheme(), "http" | "https") && u.host_str().is_some())?;
        let clicked = self.last_click.take()?;
        if now.saturating_duration_since(clicked) > CLICK_WINDOW {
            return None;
        }
        if self
            .last_open
            .is_some_and(|opened| now.saturating_duration_since(opened) < OPEN_INTERVAL)
        {
            return None;
        }
        self.last_open = Some(now);
        Some(url)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConsentMode {
    #[default]
    Closed,
    Prompt,
    Dialog,
}

impl ConsentMode {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "closed" => Some(Self::Closed),
            "prompt" => Some(Self::Prompt),
            "dialog" => Some(Self::Dialog),
            _ => None,
        }
    }
}

pub fn accepts_page_mode(current: ConsentMode, launcher_opened_dialog: bool, next: ConsentMode) -> bool {
    next != ConsentMode::Dialog || launcher_opened_dialog || current != ConsentMode::Closed
}

pub fn dialog_lost_on_load(current: ConsentMode, launcher_reopening: bool) -> bool {
    current == ConsentMode::Dialog && !launcher_reopening
}

pub fn reload_after_consent(previous: ConsentMode, next: ConsentMode, managed_from_prompt: bool) -> bool {
    next == ConsentMode::Closed
        && (previous == ConsentMode::Prompt || (previous == ConsentMode::Dialog && managed_from_prompt))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConsentAction {
    Accept,
    Reject,
    Customize,
}

impl ConsentAction {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "accept" => Some(Self::Accept),
            "reject" => Some(Self::Reject),
            "customize" => Some(Self::Customize),
            _ => None,
        }
    }

    pub fn page_name(self) -> &'static str {
        match self {
            Self::Accept => "accept",
            Self::Reject => "reject",
            Self::Customize => "customize",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct AdRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub fn consent_rect(window_width: f64, window_height: f64) -> AdRect {
    AdRect {
        x: 0.0,
        y: 0.0,
        width: window_width.max(1.0),
        height: window_height.max(1.0),
    }
}

pub const OCCLUSION_LIMIT: f64 = 0.5;
const OCCLUSION_SAMPLES: i32 = 12;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ScreenRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl ScreenRect {
    fn contains(&self, x: f64, y: f64) -> bool {
        f64::from(self.left) <= x && x < f64::from(self.right) && f64::from(self.top) <= y && y < f64::from(self.bottom)
    }
}

pub fn is_occluded(ad: ScreenRect, windows_above: &[ScreenRect]) -> bool {
    let width = f64::from(ad.right - ad.left);
    let height = f64::from(ad.bottom - ad.top);
    if width <= 0.0 || height <= 0.0 || windows_above.is_empty() {
        return false;
    }
    let step = |i: i32| (f64::from(i) + 0.5) / f64::from(OCCLUSION_SAMPLES);
    let covered = (0..OCCLUSION_SAMPLES)
        .flat_map(|i| (0..OCCLUSION_SAMPLES).map(move |j| (i, j)))
        .filter(|&(i, j)| {
            let x = f64::from(ad.left) + step(i) * width;
            let y = f64::from(ad.top) + step(j) * height;
            windows_above.iter().any(|w| w.contains(x, y))
        })
        .count();
    covered as f64 / f64::from(OCCLUSION_SAMPLES * OCCLUSION_SAMPLES) >= OCCLUSION_LIMIT
}

pub const PROFILE_PURPOSES: [u32; 2] = [3, 4];
const MAX_PURPOSES: usize = 64;

pub fn personalized_ads(consented_purposes: &[u32]) -> bool {
    consented_purposes.len() <= MAX_PURPOSES
        && PROFILE_PURPOSES.iter().all(|purpose| consented_purposes.contains(purpose))
}
