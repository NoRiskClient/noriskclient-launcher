use noriskclient_launcher_v3_lib::commands::share::logfile::{fit, prepare};

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
