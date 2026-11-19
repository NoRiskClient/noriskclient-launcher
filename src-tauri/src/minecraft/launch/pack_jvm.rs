use crate::minecraft::launch::version::compare_versions;
use log::warn;
use serde::Deserialize;
use serde_json::Value;
use sha1::{Digest, Sha1};
use std::cmp::Ordering;
use uuid::Uuid;

const GC_FLAGS: [&str; 5] = [
    "-XX:+UseZGC",
    "-XX:+UseG1GC",
    "-XX:+UseShenandoahGC",
    "-XX:+UseParallelGC",
    "-XX:+UseSerialGC",
];
pub const DEFAULT_GC_ARGS: [&str; 6] = [
    "-XX:+UnlockExperimentalVMOptions",
    "-XX:+UseG1GC",
    "-XX:G1NewSizePercent=20",
    "-XX:G1ReservePercent=20",
    "-XX:MaxGCPauseMillis=50",
    "-XX:G1HeapRegionSize=32M",
];
const UNLOCK_FLAGS: [&str; 2] = ["-XX:+UnlockExperimentalVMOptions", "-XX:+UnlockDiagnosticVMOptions"];
const BLOCKED_PROPERTIES: [&str; 10] = [
    "java.",
    "javax.",
    "jdk.",
    "sun.",
    "com.sun.",
    "log4j",
    "file.",
    "user.",
    "fabric.addmods",
    "norisk.token",
];

fn is_gc_flag(arg: &str) -> bool {
    GC_FLAGS.iter().any(|gc| arg.contains(gc))
}

pub fn sets_gc<'a>(args: impl IntoIterator<Item = &'a str>) -> bool {
    args.into_iter().any(is_gc_flag)
}

pub fn is_allowed_jvm_flag(flag: &str) -> bool {
    let plain = |text: &str| text.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if let Some(option) = flag.strip_prefix("-XX:") {
        return match option.split_once('=') {
            Some((name, value)) => {
                let digits = value.strip_suffix(['k', 'K', 'm', 'M', 'g', 'G']).unwrap_or(value);
                is_name(name) && !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit())
            }
            None => option.strip_prefix(['+', '-']).is_some_and(is_name),
        };
    }
    if let Some((key, value)) = flag.strip_prefix("-D").and_then(|property| property.split_once('=')) {
        let key_lower = key.to_ascii_lowercase();
        return !key.is_empty()
            && plain(key)
            && plain(value)
            && !BLOCKED_PROPERTIES.iter().any(|blocked| key_lower.starts_with(blocked));
    }
    false
}

fn is_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

#[derive(Debug, Clone)]
pub struct JvmContext {
    pub java_major: u32,
    pub minecraft: String,
    pub loader: String,
    pub os: String,
    pub arch: String,
    pub ram_mb: u64,
    pub heap_mb: u32,
    pub user_gc: bool,
    pub player: Option<Uuid>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct JvmPlan {
    pub args: Vec<String>,
    pub applied: Vec<String>,
}

impl JvmPlan {
    pub fn jvm_args(&self) -> Vec<String> {
        let unlock = self.args.iter().any(|arg| arg.starts_with("-XX:"));
        UNLOCK_FLAGS
            .iter()
            .filter(|_| unlock)
            .map(|flag| flag.to_string())
            .chain(self.args.iter().cloned())
            .collect()
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
struct Condition {
    java: Option<String>,
    mc: Option<String>,
    loader: Option<Vec<String>>,
    os: Option<Vec<String>>,
    arch: Option<Vec<String>>,
    ram_mb: Option<String>,
    heap_mb: Option<String>,
    rollout: Option<u8>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JvmRule {
    id: String,
    #[serde(default)]
    when: Condition,
    args: Vec<String>,
}

pub fn parse_jvm_rules(value: &Value) -> Vec<JvmRule> {
    let Some(entries) = value.as_array() else {
        if !value.is_null() {
            warn!("Pack JVM rules are not a list, ignoring them");
        }
        return Vec::new();
    };
    entries
        .iter()
        .filter_map(|entry| match serde_json::from_value::<JvmRule>(entry.clone()) {
            Ok(rule) => match rule.problem() {
                None => Some(rule),
                Some(problem) => {
                    warn!("Skipping pack JVM rule '{}': {}", rule.id, problem);
                    None
                }
            },
            Err(error) => {
                warn!("Skipping unreadable pack JVM rule: {}", error);
                None
            }
        })
        .collect()
}

impl JvmRule {
    fn problem(&self) -> Option<String> {
        if self.id.trim().is_empty() {
            return Some("missing id".to_string());
        }
        if let Some(flag) = self.args.iter().find(|flag| !is_allowed_jvm_flag(flag)) {
            return Some(format!("flag '{flag}' is not allowed"));
        }
        let when = &self.when;
        for (name, range) in [("java", &when.java), ("ramMb", &when.ram_mb), ("heapMb", &when.heap_mb)] {
            if range.as_ref().is_some_and(|range| number_range(range).is_none()) {
                return Some(format!("invalid {name} range"));
            }
        }
        if when.mc.as_ref().is_some_and(|range| version_range(range).is_none()) {
            return Some("invalid mc range".to_string());
        }
        if when.rollout.is_some_and(|percent| percent > 100) {
            return Some("rollout must be 0 to 100".to_string());
        }
        None
    }

    fn matches(&self, ctx: &JvmContext) -> bool {
        let when = &self.when;
        let number = |range: &Option<String>, value: u64| {
            range.as_ref().is_none_or(|range| {
                number_range(range).is_some_and(|terms| terms.iter().all(|(op, bound)| op.holds(value.cmp(bound))))
            })
        };
        let listed = |list: &Option<Vec<String>>, value: &str| {
            list.as_ref().is_none_or(|list| list.iter().any(|entry| entry.eq_ignore_ascii_case(value)))
        };
        let minecraft = when.mc.as_ref().is_none_or(|range| {
            version_range(range).is_some_and(|terms| {
                terms.iter().all(|(op, bound)| op.holds(compare_versions(&ctx.minecraft, bound)))
            })
        });

        number(&when.java, ctx.java_major as u64)
            && minecraft
            && number(&when.ram_mb, ctx.ram_mb)
            && number(&when.heap_mb, ctx.heap_mb as u64)
            && listed(&when.loader, &ctx.loader)
            && listed(&when.os, &ctx.os)
            && listed(&when.arch, &ctx.arch)
            && when.rollout.is_none_or(|percent| in_rollout(ctx.player, &self.id, percent))
    }
}

fn in_rollout(player: Option<Uuid>, rule_id: &str, percent: u8) -> bool {
    let Some(player) = player else {
        return false;
    };
    let digest = Sha1::digest(format!("{player}:{rule_id}").as_bytes());
    u16::from_be_bytes([digest[0], digest[1]]) % 100 < u16::from(percent)
}

#[derive(Debug, Clone, Copy)]
enum Op {
    Eq,
    Ge,
    Gt,
    Le,
    Lt,
}

impl Op {
    fn holds(self, ordering: Ordering) -> bool {
        match self {
            Op::Eq => ordering == Ordering::Equal,
            Op::Ge => ordering != Ordering::Less,
            Op::Gt => ordering == Ordering::Greater,
            Op::Le => ordering != Ordering::Greater,
            Op::Lt => ordering == Ordering::Less,
        }
    }
}

fn number_range(range: &str) -> Option<Vec<(Op, u64)>> {
    parse_range(range, |v| v.parse().ok())
}

fn version_range(range: &str) -> Option<Vec<(Op, String)>> {
    parse_range(range, |v| Some(v.to_string()))
}

fn parse_range<T>(range: &str, parse: impl Fn(&str) -> Option<T>) -> Option<Vec<(Op, T)>> {
    let terms: Option<Vec<(Op, T)>> = range
        .split_whitespace()
        .map(|term| {
            let (op, bound) = [(">=", Op::Ge), ("<=", Op::Le), (">", Op::Gt), ("<", Op::Lt), ("=", Op::Eq)]
                .into_iter()
                .find_map(|(prefix, op)| term.strip_prefix(prefix).map(|bound| (op, bound)))
                .unwrap_or((Op::Eq, term));
            (!bound.is_empty()).then(|| parse(bound)).flatten().map(|bound| (op, bound))
        })
        .collect();
    terms.filter(|terms| !terms.is_empty())
}

pub fn plan_jvm_rules(rules: &[JvmRule], ctx: &JvmContext) -> JvmPlan {
    let mut plan = JvmPlan::default();
    for rule in rules.iter().filter(|rule| rule.matches(ctx)) {
        for arg in rule.args.iter().filter(|arg| !(ctx.user_gc && is_gc_flag(arg))) {
            if !plan.args.contains(arg) {
                plan.args.push(arg.clone());
            }
        }
        plan.applied.push(rule.id.clone());
    }
    plan
}
