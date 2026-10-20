use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use serde_json::json;
use tauri::{AppHandle, Manager};

use crate::commands::analytics_command::track_with_frontend_identity;

const LOOK_EVERY: Duration = Duration::from_secs(1);
const REPORT_EVERY: Duration = Duration::from_secs(300);
const LONGEST_STEP: Duration = Duration::from_secs(5);
const MOST_KEPT: Duration = Duration::from_secs(900);
const EXIT_PATIENCE: Duration = Duration::from_millis(1500);
const LOADING_TAB: &str = "loading";
const UNKNOWN_TAB: &str = "unknown";
const LONGEST_TAB_NAME: usize = 40;
const MOST_TABS: usize = 32;

static RUNNING: AtomicBool = AtomicBool::new(false);
static WATCH: LazyLock<Mutex<Watch>> = LazyLock::new(Mutex::default);

fn watch() -> MutexGuard<'static, Watch> {
    WATCH.lock().unwrap_or_else(PoisonError::into_inner)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Presence {
    visible: bool,
    focused: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Tally {
    visible: Duration,
    focused: Duration,
}

impl Tally {
    fn add(&mut self, step: Duration, presence: Presence) {
        if !presence.visible {
            return;
        }
        let step = step.min(LONGEST_STEP);
        self.visible += step;
        if presence.focused {
            self.focused += step;
        }
    }

    fn take_whole_seconds(&mut self) -> Tally {
        let whole = Tally {
            visible: Duration::from_secs(self.visible.as_secs()),
            focused: Duration::from_secs(self.focused.as_secs()),
        };
        self.visible -= whole.visible;
        self.focused -= whole.focused;
        whole
    }

    fn put_back(&mut self, unsent: Tally) {
        self.visible = (self.visible + unsent.visible).min(MOST_KEPT);
        self.focused = (self.focused + unsent.focused).min(self.visible);
    }
}

#[derive(Debug, Default)]
struct Watch {
    tab: Option<String>,
    tabs: HashMap<String, Tally>,
}

impl Watch {
    fn add(&mut self, step: Duration, presence: Presence) {
        let tab = self.tab.as_deref().unwrap_or(LOADING_TAB).to_string();
        if let Some(tally) = self.tally_of(tab) {
            tally.add(step, presence);
        }
    }

    fn take_whole_seconds(&mut self) -> Vec<(String, Tally)> {
        self.tabs
            .iter_mut()
            .map(|(tab, tally)| (tab.clone(), tally.take_whole_seconds()))
            .filter(|(_, time)| !time.visible.is_zero())
            .collect()
    }

    fn put_back(&mut self, tab: String, unsent: Tally) {
        if let Some(tally) = self.tally_of(tab) {
            tally.put_back(unsent);
        }
    }

    fn tally_of(&mut self, tab: String) -> Option<&mut Tally> {
        if !self.tabs.contains_key(&tab) && self.tabs.len() >= MOST_TABS {
            return None;
        }
        Some(self.tabs.entry(tab).or_default())
    }
}

fn tab_name(raw: &str) -> String {
    let name: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
        .take(LONGEST_TAB_NAME)
        .collect::<String>()
        .to_ascii_lowercase();
    if name.is_empty() {
        UNKNOWN_TAB.to_string()
    } else {
        name
    }
}

pub fn set_tab(tab: &str) {
    watch().tab = Some(tab_name(tab));
}

pub fn spawn(app: AppHandle) {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let mut last_look = Instant::now();
        let mut last_report = Instant::now();
        let mut was_visible = false;

        loop {
            tokio::time::sleep(LOOK_EVERY).await;

            let now = Instant::now();
            let here = presence(&app);
            watch().add(now - last_look, here);
            last_look = now;

            let put_away = was_visible && !here.visible;
            was_visible = here.visible;
            if put_away || now - last_report >= REPORT_EVERY {
                last_report = now;
                report().await;
            }
        }
    });
}

pub fn report_before_exit() {
    let Ok(runtime) = tokio::runtime::Handle::try_current() else {
        return;
    };
    let sent = std::thread::spawn(move || {
        runtime.block_on(async {
            let _ = tokio::time::timeout(EXIT_PATIENCE, report()).await;
        })
    });
    let _ = sent.join();
}

async fn report() {
    let tabs = watch().take_whole_seconds();

    for (tab, time) in tabs {
        let (visible, focused) = (time.visible.as_secs(), time.focused.as_secs());
        let sent = track_with_frontend_identity(
            "launcher_screen_time",
            json!({ "tab": tab, "visible_seconds": visible, "focused_seconds": focused }),
        )
        .await;

        match sent {
            Ok(true) => log::debug!(
                "[Analytics] Screen time: tab={tab} visible={visible}s focused={focused}s"
            ),
            Ok(false) => log::debug!(
                "[Analytics] Screen time dropped, analytics are off: tab={tab} visible={visible}s"
            ),
            Err(e) => {
                log::debug!("[Analytics] Screen time kept for the next try: tab={tab}: {e}");
                watch().put_back(tab, time);
            }
        }
    }
}

fn presence(app: &AppHandle) -> Presence {
    let Some(window) = app.get_webview_window("main") else {
        return Presence {
            visible: false,
            focused: false,
        };
    };
    let visible =
        window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
    Presence {
        visible,
        focused: visible && window.is_focused().unwrap_or(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHOWN: Presence = Presence {
        visible: true,
        focused: false,
    };
    const IN_FRONT: Presence = Presence {
        visible: true,
        focused: true,
    };
    const AWAY: Presence = Presence {
        visible: false,
        focused: false,
    };

    fn secs(seconds: u64) -> Duration {
        Duration::from_secs(seconds)
    }

    fn tally(visible: u64, focused: u64) -> Tally {
        Tally {
            visible: secs(visible),
            focused: secs(focused),
        }
    }

    #[test]
    fn counts_only_while_shown_and_focus_only_while_in_front() {
        let mut time = Tally::default();
        time.add(secs(1), IN_FRONT);
        time.add(secs(1), SHOWN);
        time.add(secs(1), AWAY);

        assert_eq!(time, tally(2, 1));
    }

    #[test]
    fn a_long_gap_between_two_looks_counts_as_a_short_one() {
        let mut time = Tally::default();
        time.add(secs(8 * 3600), IN_FRONT);

        assert_eq!(time.visible, LONGEST_STEP);
    }

    #[test]
    fn reports_whole_seconds_and_keeps_the_rest() {
        let mut time = Tally::default();
        time.add(Duration::from_millis(2600), IN_FRONT);

        let reported = time.take_whole_seconds();

        assert_eq!(reported, tally(2, 2));
        assert_eq!(time.visible, Duration::from_millis(600));
        assert_eq!(time.focused, Duration::from_millis(600));
    }

    #[test]
    fn what_could_not_be_sent_comes_back_up_to_a_limit() {
        let mut time = tally(3, 0);

        time.put_back(tally(60, 40));
        assert_eq!(time, tally(63, 40));

        time.put_back(tally(5000, 5000));
        assert_eq!(
            time,
            Tally {
                visible: MOST_KEPT,
                focused: MOST_KEPT
            }
        );
    }

    #[test]
    fn time_goes_to_the_tab_that_is_open_and_to_loading_before_one_is_named() {
        let mut watch = Watch::default();
        watch.add(secs(2), IN_FRONT);
        watch.tab = Some(tab_name("play"));
        watch.add(secs(3), IN_FRONT);
        watch.tab = Some(tab_name("profiles"));
        watch.add(secs(4), SHOWN);
        watch.add(secs(1), AWAY);

        let mut reported = watch.take_whole_seconds();
        reported.sort_by(|a, b| a.0.cmp(&b.0));

        assert_eq!(
            reported,
            vec![
                (LOADING_TAB.to_string(), tally(2, 2)),
                ("play".to_string(), tally(3, 3)),
                ("profiles".to_string(), tally(4, 0)),
            ]
        );
        assert!(watch.take_whole_seconds().is_empty());
    }

    #[test]
    fn a_tab_name_is_a_short_plain_word() {
        assert_eq!(tab_name("Profiles"), "profiles");
        assert_eq!(tab_name("/mods?query=<script>"), "modsqueryscript");
        assert_eq!(tab_name("  "), UNKNOWN_TAB);
        assert_eq!(tab_name(&"a".repeat(200)).len(), LONGEST_TAB_NAME);
    }

    #[test]
    fn no_more_tabs_are_kept_than_a_launcher_has() {
        let mut watch = Watch::default();
        for index in 0..(MOST_TABS + 10) {
            watch.tab = Some(format!("tab{index}"));
            watch.add(secs(1), SHOWN);
        }

        assert_eq!(watch.tabs.len(), MOST_TABS);
    }
}
