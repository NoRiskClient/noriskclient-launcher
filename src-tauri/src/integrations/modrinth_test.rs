use super::*;

#[test]
fn reads_ids_from_a_cdn_link() {
    let url = "https://cdn.modrinth.com/data/4XJZeZbM/versions/kD7KNe4P/letsdo-API-fabric-1.2.15-fabric.jar";
    assert_eq!(
        ids_from_cdn_url(url),
        Some(("4XJZeZbM".to_string(), "kD7KNe4P".to_string()))
    );
}

#[test]
fn rejects_links_from_elsewhere() {
    assert_eq!(ids_from_cdn_url("https://example.com/data/a/versions/b/c.jar"), None);
    assert_eq!(ids_from_cdn_url("https://cdn.modrinth.com/other/a/versions/b/c.jar"), None);
    assert_eq!(ids_from_cdn_url("https://cdn.modrinth.com/data/a/files/b/c.jar"), None);
}

#[test]
fn rejects_a_truncated_link() {
    assert_eq!(ids_from_cdn_url("https://cdn.modrinth.com/data/4XJZeZbM"), None);
    assert_eq!(ids_from_cdn_url("https://cdn.modrinth.com/data/4XJZeZbM/versions"), None);
    assert_eq!(ids_from_cdn_url(""), None);
}

#[test]
fn accepts_the_hosts_modrinth_allows() {
    assert!(is_whitelisted_modpack_url(
        "https://cdn.modrinth.com/data/a/versions/b/c.jar"
    ));
    assert!(is_whitelisted_modpack_url("https://github.com/o/r/releases/x.jar"));
    assert!(is_whitelisted_modpack_url(
        "https://raw.githubusercontent.com/o/r/main/x.jar"
    ));
}

#[test]
fn rejects_other_hosts_and_plain_http() {
    assert!(!is_whitelisted_modpack_url("https://example.com/x.jar"));
    assert!(!is_whitelisted_modpack_url("https://evil.cdn.modrinth.com.attacker.net/x.jar"));
    assert!(!is_whitelisted_modpack_url("http://cdn.modrinth.com/data/a/versions/b/c.jar"));
    assert!(!is_whitelisted_modpack_url(""));
}
