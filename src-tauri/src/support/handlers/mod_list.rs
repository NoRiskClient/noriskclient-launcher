use super::{non_empty, redact_json};
use crate::state::content_cache_state::CacheBehaviour;
use crate::support::handler::{PreparedItem, SupportContext, SupportItemHandler};
use crate::support::types::{ItemCategory, ItemParams};
use crate::utils::profile_utils::{
    ContentType, LoadItemsParams, LocalContentItem, LocalContentLoader,
};
use async_trait::async_trait;
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::time::Duration;
use uuid::Uuid;

pub struct ModListHandler;

pub const MAX_MODS: usize = 2000;
const MAX_FIELD_CHARS: usize = 256;
const TITLE_BATCH: usize = 100;
const TITLE_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    pub source: &'static str,
    pub enabled: bool,
}

fn to_entry(item: &LocalContentItem, from_pack: bool) -> ModEntry {
    let modrinth = item.modrinth_info.as_ref();
    let curseforge = item.curseforge_info.as_ref();
    let id = if from_pack {
        item.norisk_info.as_ref().and_then(|n| non_empty(&n.mod_id))
    } else {
        modrinth
            .and_then(|m| non_empty(&m.project_id))
            .or_else(|| curseforge.and_then(|c| non_empty(&c.project_id)))
    };
    let name = modrinth
        .and_then(|m| non_empty(&m.name))
        .or_else(|| curseforge.and_then(|c| non_empty(&c.name)))
        .or_else(|| non_empty(item.filename.trim_end_matches(".disabled")));
    let version = modrinth
        .and_then(|m| non_empty(&m.version_number))
        .or_else(|| curseforge.and_then(|c| non_empty(&c.version_number)))
        .or_else(|| item.fallback_version.as_deref().and_then(non_empty));
    let source = match (from_pack, modrinth, curseforge) {
        (true, _, _) => "pack",
        (_, Some(_), _) => "modrinth",
        (_, _, Some(_)) => "curseforge",
        _ => "local",
    };
    ModEntry {
        id,
        name,
        version,
        file_name: (!from_pack).then(|| non_empty(&item.filename)).flatten(),
        source,
        enabled: !item.is_disabled,
    }
}

async fn load(
    profile_id: Uuid,
    content_type: ContentType,
) -> crate::error::Result<Vec<LocalContentItem>> {
    LocalContentLoader::load_items(LoadItemsParams {
        profile_id,
        content_type,
        calculate_hashes: false,
        fetch_modrinth_data: false,
        cache_behaviour: CacheBehaviour::default(),
    })
    .await
}

pub async fn collect_mods(ctx: &SupportContext) -> crate::error::Result<Vec<ModEntry>> {
    let user_mods = load(ctx.profile.id, ContentType::Mod).await?;
    let pack_mods = load(ctx.profile.id, ContentType::NoRiskMod)
        .await
        .unwrap_or_default();
    let mut mods: Vec<ModEntry> = pack_mods.iter().map(|m| to_entry(m, true)).collect();
    mods.extend(
        user_mods
            .iter()
            .filter(|m| !m.is_directory)
            .map(|m| to_entry(m, false)),
    );
    apply_modrinth_titles(&mut mods).await;
    mods.sort_by_cached_key(|m| m.name.as_deref().unwrap_or_default().to_lowercase());
    Ok(mods)
}

async fn modrinth_titles(ids: Vec<String>) -> HashMap<String, String> {
    let mut titles = HashMap::new();
    for batch in ids.chunks(TITLE_BATCH) {
        match crate::integrations::modrinth::get_multiple_projects(batch.to_vec()).await {
            Ok(projects) => titles.extend(projects.into_iter().map(|p| (p.id, p.title))),
            Err(e) => log::debug!("[Support] Modrinth titles unavailable: {}", e),
        }
    }
    titles
}

async fn apply_modrinth_titles(mods: &mut [ModEntry]) {
    let mut ids: Vec<String> = mods
        .iter()
        .filter(|m| m.source == "modrinth")
        .filter_map(|m| m.id.clone())
        .collect();
    ids.sort();
    ids.dedup();
    if ids.is_empty() {
        return;
    }
    let Ok(titles) = tokio::time::timeout(TITLE_TIMEOUT, modrinth_titles(ids)).await else {
        log::debug!("[Support] Modrinth titles timed out");
        return;
    };
    for entry in mods.iter_mut().filter(|m| m.source == "modrinth") {
        if let Some(title) = entry.id.as_ref().and_then(|id| titles.get(id)).and_then(|t| non_empty(t)) {
            entry.name = Some(title);
        }
    }
}

#[async_trait]
impl SupportItemHandler for ModListHandler {
    fn type_id(&self) -> &'static str {
        "MOD_LIST"
    }

    fn category(&self) -> ItemCategory {
        ItemCategory::Collect
    }

    async fn prepare(&self, ctx: &SupportContext, _params: &ItemParams) -> PreparedItem {
        let mut mods = match collect_mods(ctx).await {
            Ok(m) => m,
            Err(e) => return PreparedItem::failed(format!("could not list mods: {}", e)),
        };
        let total = mods.len();
        let enabled = mods.iter().filter(|m| m.enabled).count();
        mods.truncate(MAX_MODS);

        let summary = format!("{} mods ({} enabled)", total, enabled);
        let mut prepared =
            PreparedItem::data(redact_json(json!({ "mods": mods }), MAX_FIELD_CHARS), None);
        if total > MAX_MODS {
            let note = format!("mod list cut to the first {} of {} mods", MAX_MODS, total);
            prepared.summary = Some(format!("{} · {}", summary, note));
            prepared.truncated = true;
            prepared.note = Some(note);
        } else {
            prepared.summary = Some(summary);
        }
        prepared
    }
}
