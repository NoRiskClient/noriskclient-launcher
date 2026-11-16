//! A log made fit to share: no secrets, no terminal codes, and small enough for the media server.

use once_cell::sync::Lazy;
use regex::Regex;

/// What the media server takes when its limits cannot be read.
pub(super) const DEFAULT_MAX_BYTES: u64 = 5 * 1024 * 1024;
/// The start of a log names the mods and the setup; the crash sits at the end.
const HEAD_BYTES: usize = 1024 * 1024;
const MARKER_BYTES: usize = 64;

/// ANSI colour codes first, then every other control character the media server refuses.
static CONTROLS: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\x1b\[[0-?]*[ -/]*[@-~]|[\x00-\x08\x0b\x0c\x0e-\x1f]").unwrap());

pub(super) fn prepare(raw: &str, max_bytes: usize) -> String {
    let clean = CONTROLS.replace_all(raw, "");
    let redacted = crate::utils::security_utils::mask_sensitive_data(&clean);
    fit(&redacted, max_bytes)
}

/// Keeps the head and the tail on whole lines, with one line saying how much was left out.
fn fit(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_string();
    }
    let budget = max_bytes.saturating_sub(MARKER_BYTES);
    let head_end = line_end_before(text, HEAD_BYTES.min(budget / 5));
    let tail_start = line_start_after(text, text.len() - (budget - head_end)).max(head_end);

    let cut = text[head_end..tail_start].matches('\n').count();
    let mut out = String::with_capacity(max_bytes);
    out.push_str(&text[..head_end]);
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(&format!("----- {cut} lines cut -----\n"));
    out.push_str(&text[tail_start..]);
    out
}

/// Where the last whole line at or before `at` ends, or a char boundary when there is none.
fn line_end_before(text: &str, at: usize) -> usize {
    let mut at = at.min(text.len());
    while !text.is_char_boundary(at) {
        at -= 1;
    }
    text[..at].rfind('\n').map_or(at, |n| n + 1)
}

/// Where the first whole line at or after `at` starts, or a char boundary when there is none.
fn line_start_after(text: &str, at: usize) -> usize {
    let mut at = at.min(text.len());
    while !text.is_char_boundary(at) {
        at += 1;
    }
    text[at..].find('\n').map_or(at, |n| at + n + 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn redacted(line: &str) -> String {
        prepare(line, usize::MAX)
    }

    #[test]
    fn launch_arguments_and_session_lines_lose_their_secrets() {
        let args = "[12:00:01] [main/INFO]: Launching with --username Steve --uuid 069a79f444e94726a5befca90e38aaf5 \
                    --accessToken eyJhbGciOiJIUzI1NiJ9.eyJ4dWlkIjoiMjUzNTQ1In0.c2lnbmF0dXJl --clientId MTIzNDU2Nzg5 \
                    --xuid 2535405290012345 --userType msa";
        let out = redacted(args);
        for secret in ["069a79f444e94726a5befca90e38aaf5", "eyJhbGciOiJIUzI1NiJ9", "MTIzNDU2Nzg5", "2535405290012345"] {
            assert!(!out.contains(secret), "{secret} left in {out}");
        }
        assert!(out.contains("--username Steve") && out.contains("--userType msa"), "{out}");

        let session = redacted("[12:00:02] [Render thread/INFO]: Session ID is token:eyJraWQiOiJhYmMifQ.eyJzdWIiOiJ4In0.sig:069a79f4");
        assert!(!session.contains("eyJraWQ") && !session.contains("069a79f4"), "{session}");
        assert!(redacted("auth accessToken=abc.def.ghi&x=1").contains("accessToken=*****"));
        assert!(!redacted("Bearer eyJ0eXAiOiJKV1QifQ.eyJhIjoxfQ.abc_def-123 sent").contains("eyJ0eXAi"));
    }

    #[test]
    fn addresses_go_but_loopback_and_versions_stay() {
        let out = redacted("Connecting to 185.199.110.153:25565, bound 0.0.0.0 and 127.0.0.1, peer 2a01:4f8:c17:1a2b::1 or ::1, Fabric Loader 0.16.10 on 1.21.4");
        assert!(!out.contains("185.199.110.153") && !out.contains("2a01:4f8:c17:1a2b::1"), "{out}");
        assert!(out.contains("0.0.0.0") && out.contains("127.0.0.1") && out.contains("::1") && out.contains("0.16.10 on 1.21.4"), "{out}");
    }

    #[test]
    fn the_user_name_in_home_paths_goes() {
        let out = redacted(
            "Loading C:\\Users\\Enrico Müller\\AppData\\Roaming\\.minecraft\\mods\\sodium.jar, /home/enrico/.minecraft and /Users/enrico/Library",
        );
        assert!(!out.contains("Enrico Müller") && !out.contains("/enrico/"), "{out}");
        assert!(out.contains("C:\\Users\\*****\\AppData") && out.contains("/home/*****/.minecraft"), "{out}");
    }

    #[test]
    fn terminal_codes_and_control_bytes_go_tabs_and_breaks_stay() {
        assert_eq!(
            redacted("\x1b[32m[INFO]\x1b[0m done\x07\r\n\tat net.minecraft.Main\0\n"),
            "[INFO] done\r\n\tat net.minecraft.Main\n"
        );
    }

    fn numbered(lines: usize) -> String {
        (0..lines).map(|n| format!("[12:00:00] [main/INFO]: line {n} äöü\n")).collect()
    }

    #[test]
    fn a_log_that_fits_stays_whole() {
        let log = numbered(100);
        assert_eq!(fit(&log, log.len()), log);
    }

    #[test]
    fn a_big_log_keeps_its_head_and_its_tail_on_whole_lines() {
        let log = numbered(200_000);
        let max = 2 * 1024 * 1024;
        let out = fit(&log, max);

        assert!(out.len() <= max, "{} bytes", out.len());
        assert!(out.starts_with("[12:00:00] [main/INFO]: line 0 äöü\n"));
        assert!(out.ends_with("line 199999 äöü\n"));
        let marker = out.lines().find(|l| l.starts_with("----- ")).unwrap();
        let kept = out.lines().filter(|l| l.starts_with("[12:00:00]")).count();
        assert_eq!(marker, format!("----- {} lines cut -----", 200_000 - kept));
        assert!(out.lines().all(|l| l.starts_with("----- ") || l.ends_with(" äöü")), "a line was cut in half");
    }

    #[test]
    fn one_endless_line_is_cut_on_a_char_boundary() {
        let log = "ä".repeat(3_000);
        let out = fit(&log, 1_000);
        assert!(out.len() <= 1_000);
        assert!(out.contains("----- 0 lines cut -----"));
    }
}
