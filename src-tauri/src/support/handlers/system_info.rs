use super::{non_empty, redacted_data};
use crate::support::handler::{PreparedItem, SupportContext, SupportItemHandler};
use crate::support::types::{ItemCategory, ItemParams};
use crate::utils::system_info::total_ram_mb;
use async_trait::async_trait;
use serde::Serialize;
use sysinfo::{CpuRefreshKind, RefreshKind, System};

pub struct SystemInfoHandler;

const MAX_FIELD_CHARS: usize = 128;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemInfo {
    #[serde(skip_serializing_if = "Option::is_none")]
    os: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    os_version: Option<String>,
    arch: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    cpu: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cpu_cores: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    memory_total_mb: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    java_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    java_vendor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    locale: Option<String>,
}

fn env_locale() -> Option<String> {
    ["LC_ALL", "LC_MESSAGES", "LANG"]
        .iter()
        .filter_map(|k| std::env::var(k).ok())
        .filter_map(|v| non_empty(v.split('.').next().unwrap_or_default()))
        .find(|v| v != "C" && v != "POSIX")
}

fn collect_cpu() -> (Option<String>, Option<usize>) {
    let mut sys =
        System::new_with_specifics(RefreshKind::nothing().with_cpu(CpuRefreshKind::nothing()));
    sys.refresh_cpu_list(CpuRefreshKind::nothing());
    let cpu = sys.cpus().first().and_then(|c| non_empty(c.brand()));
    let cores = System::physical_core_count().or_else(|| Some(sys.cpus().len()).filter(|n| *n > 0));
    (cpu, cores)
}

#[async_trait]
impl SupportItemHandler for SystemInfoHandler {
    fn type_id(&self) -> &'static str {
        "SYSTEM_INFO"
    }

    fn category(&self) -> ItemCategory {
        ItemCategory::Collect
    }

    async fn prepare(&self, ctx: &SupportContext, _params: &ItemParams) -> PreparedItem {
        let ((cpu, cpu_cores), memory_total_mb) =
            tokio::task::spawn_blocking(|| (collect_cpu(), total_ram_mb()))
                .await
                .unwrap_or(((None, None), 0));
        let java = super::profile_summary::detect_profile_java(ctx).await;

        let info = SystemInfo {
            os: System::name()
                .as_deref()
                .and_then(non_empty)
                .or_else(|| Some(std::env::consts::OS.to_string())),
            os_version: System::long_os_version()
                .as_deref()
                .and_then(non_empty)
                .or_else(|| System::os_version().as_deref().and_then(non_empty)),
            arch: std::env::consts::ARCH,
            cpu,
            cpu_cores,
            memory_total_mb: Some(memory_total_mb).filter(|m| *m > 0),
            java_version: java.version,
            java_vendor: java.vendor,
            locale: env_locale(),
        };
        let line = [
            info.os_version.clone().or_else(|| info.os.clone()),
            Some(info.arch.to_string()),
            info.cpu.clone(),
            info.memory_total_mb.map(|m| format!("{} MB RAM", m)),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" · ");
        redacted_data(&info, MAX_FIELD_CHARS, line)
    }
}
