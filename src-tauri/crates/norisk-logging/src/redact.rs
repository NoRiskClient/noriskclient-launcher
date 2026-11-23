use lazy_static::lazy_static;
use once_cell::sync::Lazy;
use regex::{Captures, Regex, RegexSet};
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

const MIN_NEEDLE_LEN: usize = 3;

const GENERIC_IDENTITIES: &[&str] = &[
    "localhost",
    "user",
    "users",
    "admin",
    "administrator",
    "root",
    "owner",
    "pc",
    "default",
    "public",
    "guest",
    "home",
];

const CHUNK_BYTES: usize = 256 * 1024;

struct NeedleMatcher {
    regex: Regex,
    placeholders: HashMap<String, &'static str>,
    bounded: bool,
}

impl NeedleMatcher {
    fn new(needles: Vec<(String, &'static str)>, bounded: bool) -> Option<Self> {
        let mut needles: Vec<(String, &'static str)> = needles
            .into_iter()
            .filter(|(n, _)| n.chars().count() >= MIN_NEEDLE_LEN)
            .collect();
        if needles.is_empty() {
            return None;
        }
        needles.sort_by_key(|n| std::cmp::Reverse(n.0.len()));
        let mut placeholders = HashMap::new();
        let mut alternatives = Vec::new();
        for (needle, placeholder) in needles {
            let key = needle.to_lowercase();
            if placeholders.contains_key(&key) {
                continue;
            }
            alternatives.push(regex::escape(&needle));
            placeholders.insert(key, placeholder);
        }
        let regex = Regex::new(&format!("(?i)(?:{})", alternatives.join("|"))).ok()?;
        Some(Self {
            regex,
            placeholders,
            bounded,
        })
    }

    fn apply<'a>(&self, text: Cow<'a, str>) -> Cow<'a, str> {
        if !self.regex.is_match(&text) {
            return text;
        }
        let is_word = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric() || c == '_');
        let mut out = String::with_capacity(text.len());
        let mut last = 0;
        for m in self.regex.find_iter(&text) {
            if self.bounded {
                let prev = text[..m.start()].chars().next_back();
                let next = text[m.end()..].chars().next();
                if is_word(prev) || is_word(next) {
                    continue;
                }
            }
            let placeholder = self
                .placeholders
                .get(&m.as_str().to_lowercase())
                .copied()
                .unwrap_or("*****");
            out.push_str(&text[last..m.start()]);
            out.push_str(placeholder);
            last = m.end();
        }
        if last == 0 {
            return text;
        }
        out.push_str(&text[last..]);
        Cow::Owned(out)
    }
}

type SharedMatcher = RwLock<Option<Arc<NeedleMatcher>>>;

static KNOWN_ACCOUNTS: Lazy<SharedMatcher> = Lazy::new(|| RwLock::new(None));
static LOCAL_HOSTNAME: Lazy<SharedMatcher> = Lazy::new(|| {
    RwLock::new(identity_matcher(
        detect_local_hostname().as_deref(),
        "<HOST>",
    ))
});
static LOCAL_USERNAME: Lazy<SharedMatcher> = Lazy::new(|| {
    RwLock::new(identity_matcher(
        detect_local_username().as_deref(),
        "<USER>",
    ))
});

fn non_empty_env(keys: &[&str]) -> Option<String> {
    keys.iter()
        .filter_map(|k| std::env::var(k).ok())
        .map(|v| v.trim().to_string())
        .find(|v| !v.is_empty())
}

fn detect_local_hostname() -> Option<String> {
    if let Some(name) = non_empty_env(&["COMPUTERNAME", "HOSTNAME"]) {
        return Some(name);
    }
    #[cfg(unix)]
    {
        if let Ok(raw) = std::fs::read_to_string("/etc/hostname") {
            let trimmed = raw.trim().to_string();
            if !trimmed.is_empty() {
                return Some(trimmed);
            }
        }
    }
    None
}

fn detect_local_username() -> Option<String> {
    non_empty_env(&["USERNAME", "USER", "LOGNAME"])
}

fn is_generic(name: &str) -> bool {
    GENERIC_IDENTITIES
        .iter()
        .any(|g| name.eq_ignore_ascii_case(g))
}

fn identity_needles(name: &str) -> Vec<String> {
    let name = name.trim();
    if name.chars().count() < MIN_NEEDLE_LEN || is_generic(name) {
        return Vec::new();
    }
    let mut needles = vec![name.to_string()];
    let short = name.split('.').next().unwrap_or(name);
    if short != name && short.chars().count() >= MIN_NEEDLE_LEN && !is_generic(short) {
        needles.push(short.to_string());
    }
    let compact: String = name
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '.')
        .collect();
    if compact.chars().count() > 8 || compact.len() != name.len() {
        let stem: String = compact.chars().take(6).collect();
        if stem.chars().count() >= MIN_NEEDLE_LEN {
            for i in 1..=4 {
                needles.push(format!("{}~{}", stem, i));
            }
        }
    }
    needles
}

fn identity_matcher(name: Option<&str>, placeholder: &'static str) -> Option<Arc<NeedleMatcher>> {
    let needles = identity_needles(name?)
        .into_iter()
        .map(|n| (n, placeholder))
        .collect();
    NeedleMatcher::new(needles, true).map(Arc::new)
}

pub fn set_local_hostname(hostname: Option<&str>) {
    if let Ok(mut guard) = LOCAL_HOSTNAME.write() {
        *guard = identity_matcher(hostname, "<HOST>");
    }
}

pub fn set_local_username(username: Option<&str>) {
    if let Ok(mut guard) = LOCAL_USERNAME.write() {
        *guard = identity_matcher(username, "<USER>");
    }
}

pub fn set_known_accounts(accounts: &[(String, String)]) {
    let mut needles: Vec<(String, &'static str)> = Vec::new();
    for (username, uuid) in accounts {
        needles.push((username.clone(), "<PLAYER>"));
        needles.push((uuid.clone(), "<PLAYER_UUID>"));
        needles.push((uuid.replace('-', ""), "<PLAYER_UUID>"));
    }
    let matcher = NeedleMatcher::new(needles, false).map(Arc::new);
    if let Ok(mut guard) = KNOWN_ACCOUNTS.write() {
        *guard = matcher;
    }
}

enum Replace {
    Template(&'static str),
    With(fn(&Captures) -> Option<String>),
}

struct Rule {
    pattern: &'static str,
    replace: Replace,
}

fn basic_auth(c: &Captures) -> Option<String> {
    let value = c.get(2)?.as_str();
    let after_header = c.get(1).is_some();
    let looks_encoded = value
        .chars()
        .any(|ch| ch.is_ascii_digit() || matches!(ch, '=' | '+' | '/'));
    (after_header || looks_encoded)
        .then(|| format!("{}Basic *****", c.get(1).map_or("", |m| m.as_str())))
}

fn chat_password_command(c: &Captures) -> Option<String> {
    Some(format!("{}{} ***", &c[1], &c[2]))
}

const RULES: &[Rule] = &[
    Rule {
        pattern: r"-Dnorisk\.token=[^\s]+",
        replace: Replace::Template("-Dnorisk.token=*****"),
    },
    Rule {
        pattern: r"--accessToken\s+[^\s]+",
        replace: Replace::Template("--accessToken *****"),
    },
    Rule {
        pattern: r"--clientId\s+[^\s]+",
        replace: Replace::Template("--clientId *****"),
    },
    Rule {
        pattern: r"--xuid\s+[^\s]+",
        replace: Replace::Template("--xuid *****"),
    },
    Rule {
        pattern: r"(?i)(?-u:\b)Bearer\s+[A-Za-z0-9._~+/=-]+",
        replace: Replace::Template("Bearer *****"),
    },
    Rule {
        pattern: r"(?i)(Authorization:\s*)?(?-u:\b)Basic\s+([A-Za-z0-9+/]{6,}={0,2})",
        replace: Replace::With(basic_auth),
    },
    Rule {
        pattern: r#"(?i)"(value|token|access_token|accessToken|refresh_token|refreshToken|id_token|client_secret|DeviceToken|TitleToken|UserToken|XSTSToken|authorization)"\s*:\s*"[^"]*""#,
        replace: Replace::Template("\"$1\":\"*****\""),
    },
    Rule {
        pattern: r#"(?i)(?-u:\b)(access_token|refresh_token|id_token)\s*:\s*Some\("[^"]*"\)"#,
        replace: Replace::Template("$1: Some(\"*****\")"),
    },
    Rule {
        pattern: r#"(?i)(?-u:\b)(access_token|refresh_token|id_token)\s*:\s*"[^"]*""#,
        replace: Replace::Template("$1: \"*****\""),
    },
    Rule {
        pattern: r#"(?i)(?-u:\b)(access_token|refresh_token|id_token|code|client_secret|password|token|sig|signature)=[^&\s"]+"#,
        replace: Replace::Template("$1=*****"),
    },
    Rule {
        pattern: r"(?-u:\b)eyJ[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]*){0,2}",
        replace: Replace::Template("*****"),
    },
    Rule {
        pattern: r"(?-u:\b)M\.C\d\S*?\.\S+",
        replace: Replace::Template("*****"),
    },
    Rule {
        pattern: r"(?-u:\b)EwA[A-Za-z0-9+/=_-]{20,}",
        replace: Replace::Template("*****"),
    },
    Rule {
        pattern: r"(?-u:\b)[MNO][A-Za-z0-9_-]{23,27}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}",
        replace: Replace::Template("*****"),
    },
    Rule {
        pattern: r"(?-u:\b)mfa\.[A-Za-z0-9_-]{60,}",
        replace: Replace::Template("*****"),
    },
    Rule {
        pattern: r#"(?i)([A-Z]:[/\\]+Users[/\\]+)[^/\\"'\r\n<>|]{1,64}?([/\\])"#,
        replace: Replace::Template("${1}*****${2}"),
    },
    Rule {
        pattern: r#"(?i)([A-Z]:[/\\]+Users[/\\]+)[^/\\"'\s]+"#,
        replace: Replace::Template("${1}*****"),
    },
    Rule {
        pattern: r#"(/+(?:home|Users)/+)[^/"'\s]+"#,
        replace: Replace::Template("${1}*****"),
    },
    Rule {
        pattern: r#"OneDrive - [^/\\"'\r\n]+"#,
        replace: Replace::Template("OneDrive - *****"),
    },
    Rule {
        pattern: r"(?-u:\b)[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?-u:\b)",
        replace: Replace::Template("*****@*****"),
    },
    Rule {
        pattern: r"--session\s+[^\s]+",
        replace: Replace::Template("--session *****"),
    },
    Rule {
        pattern: r"--uuid\s+[^\s]+",
        replace: Replace::Template("--uuid *****"),
    },
    Rule {
        pattern: r#"(?i)(?-u:\b)token:[^\s"',;]+"#,
        replace: Replace::Template("token:*****"),
    },
    Rule {
        pattern: r#"(?im)(^|[\s\]>:"'])(/(?:login|l|register|reg|changepassword|changepw|cp))[ \t]+[^\r\n]+"#,
        replace: Replace::With(chat_password_command),
    },
    Rule {
        pattern: r"(?i)(?-u:\b)[0-9a-f]{2}(?::[0-9a-f]{2}){5}(?-u:\b)|(?-u:\b)[0-9a-f]{2}(?:-[0-9a-f]{2}){5}(?-u:\b)",
        replace: Replace::Template("<MAC>"),
    },
];

static COMPILED_RULES: Lazy<(RegexSet, Vec<Regex>)> = Lazy::new(|| {
    let patterns: Vec<&str> = RULES.iter().map(|r| r.pattern).collect();
    let set = RegexSet::new(&patterns).expect("redaction rule set");
    let regexes = patterns
        .iter()
        .map(|p| Regex::new(p).expect("redaction rule"))
        .collect();
    (set, regexes)
});

fn apply_rules(chunk: &str) -> Cow<'_, str> {
    let (set, regexes) = &*COMPILED_RULES;
    let mut text: Cow<'_, str> = Cow::Borrowed(chunk);
    let candidates: Vec<usize> = set.matches(chunk).into_iter().collect();
    for index in candidates {
        let regex = &regexes[index];
        let replaced = match &RULES[index].replace {
            Replace::Template(template) => regex.replace_all(&text, *template).into_owned(),
            Replace::With(f) => regex
                .replace_all(&text, |c: &Captures| {
                    f(c).unwrap_or_else(|| c[0].to_string())
                })
                .into_owned(),
        };
        text = Cow::Owned(replaced);
    }
    text
}

fn current(slot: &SharedMatcher) -> Option<Arc<NeedleMatcher>> {
    slot.read().ok().and_then(|guard| guard.clone())
}

fn mask_chunk(chunk: &str) -> String {
    let mut text = apply_rules(chunk);
    if text.contains('.') || text.contains(':') {
        text = Cow::Owned(mask_ip_addresses(&text));
    }
    for slot in [&*LOCAL_HOSTNAME, &*LOCAL_USERNAME, &*KNOWN_ACCOUNTS] {
        if let Some(matcher) = current(slot) {
            text = matcher.apply(text);
        }
    }
    text.into_owned()
}

pub fn mask_sensitive_data(content: &str) -> String {
    if content.len() <= CHUNK_BYTES {
        return mask_chunk(content);
    }
    let mut out = String::with_capacity(content.len());
    let mut start = 0;
    while start < content.len() {
        let mut end = (start + CHUNK_BYTES).min(content.len());
        while end < content.len() && !content.is_char_boundary(end) {
            end += 1;
        }
        if end < content.len() {
            end = match content[end..].find('\n') {
                Some(n) => end + n + 1,
                None => content.len(),
            };
        }
        out.push_str(&mask_chunk(&content[start..end]));
        start = end;
    }
    out
}

const IP_PLACEHOLDER: &str = "<IP>";

fn mask_ip_addresses(content: &str) -> String {
    lazy_static! {
        static ref IPV4_REGEX: Regex = Regex::new(
            r"(?-u:\b)(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(?-u:\b)"
        ).unwrap();
        static ref IPV6_REGEX: Regex = Regex::new(r"(?i)(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}").unwrap();
    }

    let after_v4 = replace_filtered(&IPV4_REGEX, content, |candidate, prev, next, rest| {
        if matches!(prev, Some('.' | '-' | '_' | '+' | 'v' | 'V')) {
            return false;
        }
        if matches!(next, Some('-' | '_' | '+')) {
            return false;
        }
        if next == Some('.')
            && rest.chars().nth(1).is_some_and(|c| c.is_ascii_alphanumeric())
        {
            return false;
        }
        !(candidate.starts_with("127.") || candidate == "0.0.0.0")
    });

    replace_filtered(&IPV6_REGEX, &after_v4, |candidate, prev, next, _rest| {
        let is_word = |c: Option<char>| c.is_some_and(|c| c.is_ascii_alphanumeric() || c == '_');
        if is_word(prev) || is_word(next) || prev == Some(':') || next == Some(':') {
            return false;
        }
        let groups = candidate.split(':').filter(|g| !g.is_empty()).count();
        let colons = candidate.matches(':').count();
        if !(colons == 7 || (candidate.contains("::") && groups >= 2)) {
            return false;
        }
        let lower = candidate.to_ascii_lowercase();
        !matches!(
            lower.as_str(),
            "::1" | "::" | "0:0:0:0:0:0:0:1" | "0:0:0:0:0:0:0:0"
        )
    })
}

fn replace_filtered<F>(regex: &Regex, content: &str, mut accept: F) -> String
where
    F: FnMut(&str, Option<char>, Option<char>, &str) -> bool,
{
    let mut out = String::with_capacity(content.len());
    let mut last = 0;
    let mut replaced = false;
    for m in regex.find_iter(content) {
        let prev = content[..m.start()].chars().next_back();
        let rest = &content[m.end()..];
        let next = rest.chars().next();
        if accept(m.as_str(), prev, next, rest) {
            out.push_str(&content[last..m.start()]);
            out.push_str(IP_PLACEHOLDER);
            last = m.end();
            replaced = true;
        }
    }
    if !replaced {
        return content.to_string();
    }
    out.push_str(&content[last..]);
    out
}

pub const HS_ERR_ENV_REMOVED_MARKER: &str =
    "Environment Variables: [removed by NoRisk Launcher for privacy]";

pub fn redact_hs_err(content: &str) -> String {
    let mut kept = String::with_capacity(content.len());
    let mut in_env = false;
    for line in content.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if in_env {
            let is_var =
                trimmed.contains('=') || trimmed.starts_with(' ') || trimmed.starts_with('\t');
            if trimmed.trim().is_empty() || !is_var {
                in_env = false;
            } else {
                continue;
            }
        }
        if trimmed.trim_start().starts_with("Environment Variables:") {
            in_env = true;
            kept.push_str(HS_ERR_ENV_REMOVED_MARKER);
            kept.push('\n');
            continue;
        }
        kept.push_str(line);
    }
    mask_sensitive_data(&kept)
}

pub fn mask_identifier(value: &str) -> String {
    const KEEP: usize = 8;
    match value.char_indices().nth(KEEP) {
        Some((split, _)) => format!("{}...", &value[..split]),
        None => "*****".to_string(),
    }
}
