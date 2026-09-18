use crate::error::{AppError, CommandError};
use crate::minecraft::api::legal_api::{LegalApi, LegalDocumentUpdate};
use crate::state::state_manager::State;
use log::{info, warn};
use serde::Serialize;
use sqlx::{Row, SqlitePool};
use std::collections::HashMap;
use tauri::command;

type Result<T> = std::result::Result<T, CommandError>;

const FALLBACK_LOCALE: &str = "en";

const LEGACY_ACCEPTANCE_CUTOFF_MS: i64 = 1_789_689_600_000;

#[derive(Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LegalDocumentKind {
    Consent,
    Notice,
    Reference,
}

const LEGAL_DOCUMENTS: [(&str, LegalDocumentKind); 3] = [
    ("terms", LegalDocumentKind::Consent),
    ("privacy", LegalDocumentKind::Notice),
    ("licenses", LegalDocumentKind::Reference),
];

type Acknowledged = HashMap<(String, String), u32>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingLegalDocument {
    slug: String,
    locale: String,
    title: String,
    version: u32,
    updated_at: i64,
    change_summary: Option<String>,
    kind: LegalDocumentKind,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegalPrompt {
    first_time: bool,
    documents: Vec<PendingLegalDocument>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LegalStatus {
    prompt: Option<LegalPrompt>,
    notice: Option<PendingLegalDocument>,
}

async fn pool() -> Result<SqlitePool> {
    let state = State::get().await?;
    crate::state::db::pool_of(&state.db).await.ok_or_else(|| {
        AppError::Other("The launcher database is not available".to_string()).into()
    })
}

async fn fetch_updates() -> Result<Vec<LegalDocumentUpdate>> {
    let is_experimental = State::get().await?.config_manager.is_experimental_mode().await;
    Ok(LegalApi::get_updates(is_experimental).await?)
}

fn kind_of(doc: &LegalDocumentUpdate) -> Option<LegalDocumentKind> {
    LEGAL_DOCUMENTS
        .iter()
        .find(|(slug, _)| *slug == doc.slug)
        .map(|(_, kind)| *kind)
}

async fn acknowledged_versions(pool: &SqlitePool) -> Result<Acknowledged> {
    let rows = sqlx::query("SELECT slug, locale, version FROM legal_acceptances")
        .fetch_all(pool)
        .await
        .map_err(AppError::from)?;
    Ok(rows
        .iter()
        .map(|row| {
            let version: i64 = row.get("version");
            ((row.get("slug"), row.get("locale")), version.max(0) as u32)
        })
        .collect())
}

async fn store_versions(pool: &SqlitePool, documents: &[&LegalDocumentUpdate]) -> Result<()> {
    let acknowledged_at = chrono::Utc::now().timestamp_millis();
    let mut tx = pool.begin().await.map_err(AppError::from)?;
    for doc in documents {
        sqlx::query(
            "INSERT INTO legal_acceptances (slug, locale, version, accepted_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (slug, locale) DO UPDATE SET version = excluded.version, accepted_at = excluded.accepted_at",
        )
        .bind(&doc.slug)
        .bind(&doc.locale)
        .bind(doc.version as i64)
        .bind(acknowledged_at)
        .execute(&mut *tx)
        .await
        .map_err(AppError::from)?;
    }
    tx.commit().await.map_err(AppError::from)?;
    Ok(())
}

async fn acknowledge_where(keep: impl Fn(LegalDocumentKind) -> bool) -> Result<()> {
    let updates = fetch_updates().await?;
    let documents: Vec<&LegalDocumentUpdate> = updates
        .iter()
        .filter(|doc| kind_of(doc).is_some_and(&keep))
        .collect();
    store_versions(&pool().await?, &documents).await
}

fn document_for<'a>(
    updates: &'a [LegalDocumentUpdate],
    slug: &str,
    locale: &str,
) -> Option<&'a LegalDocumentUpdate> {
    let find = |locale: &str| updates.iter().find(|doc| doc.slug == slug && doc.locale == locale);
    find(locale).or_else(|| find(FALLBACK_LOCALE))
}

fn is_outdated(doc: &LegalDocumentUpdate, acknowledged: &Acknowledged) -> bool {
    doc.acknowledgement_version.is_some_and(|required| {
        let key = (doc.slug.clone(), doc.locale.clone());
        acknowledged.get(&key).copied().unwrap_or(0) < required
    })
}

fn carries_over_from_legacy(doc: &LegalDocumentUpdate) -> bool {
    kind_of(doc).is_some_and(|kind| kind != LegalDocumentKind::Notice)
        && doc
            .acknowledgement_updated_at
            .is_none_or(|at| at <= LEGACY_ACCEPTANCE_CUTOFF_MS)
}

fn pending_document(
    doc: &LegalDocumentUpdate,
    kind: LegalDocumentKind,
    first_time: bool,
) -> PendingLegalDocument {
    let latest_needs_acknowledgement = doc.acknowledgement_version == Some(doc.version);
    PendingLegalDocument {
        slug: doc.slug.clone(),
        locale: doc.locale.clone(),
        title: doc.title.clone(),
        version: doc.version,
        updated_at: if first_time {
            doc.updated_at
        } else {
            doc.acknowledgement_updated_at.unwrap_or(doc.updated_at)
        },
        change_summary: doc
            .change_summary
            .as_deref()
            .map(str::trim)
            .filter(|summary| latest_needs_acknowledgement && !summary.is_empty())
            .map(str::to_string),
        kind,
    }
}

#[command]
pub async fn get_legal_status(locale: String, accepted_legacy_terms: bool) -> Result<LegalStatus> {
    let updates = match fetch_updates().await {
        Ok(updates) => updates,
        Err(e) => {
            warn!("Skipping the legal check, updates could not be fetched: {:?}", e);
            return Ok(LegalStatus::default());
        }
    };

    let pool = pool().await?;
    let mut acknowledged = acknowledged_versions(&pool).await?;

    if acknowledged.is_empty() && accepted_legacy_terms {
        info!("Carrying over the terms accepted in an earlier launcher version");
        let carried: Vec<&LegalDocumentUpdate> =
            updates.iter().filter(|doc| carries_over_from_legacy(doc)).collect();
        store_versions(&pool, &carried).await?;
        acknowledged = acknowledged_versions(&pool).await?;
    }

    let first_time = acknowledged.is_empty();
    let current: Vec<(&LegalDocumentUpdate, LegalDocumentKind)> = LEGAL_DOCUMENTS
        .iter()
        .filter_map(|(slug, kind)| document_for(&updates, slug, &locale).map(|doc| (doc, *kind)))
        .collect();

    let outdated = |kind: LegalDocumentKind| -> Vec<&(&LegalDocumentUpdate, LegalDocumentKind)> {
        current
            .iter()
            .filter(|(doc, doc_kind)| *doc_kind == kind && is_outdated(doc, &acknowledged))
            .collect()
    };
    let outdated_consent = outdated(LegalDocumentKind::Consent);
    let outdated_notice = outdated(LegalDocumentKind::Notice);

    if first_time && current.iter().any(|(_, kind)| *kind == LegalDocumentKind::Consent) {
        let documents = current
            .iter()
            .map(|(doc, kind)| pending_document(doc, *kind, true))
            .collect();
        return Ok(LegalStatus {
            prompt: Some(LegalPrompt { first_time, documents }),
            notice: None,
        });
    }

    if !outdated_consent.is_empty() {
        let documents = outdated_consent
            .iter()
            .chain(outdated_notice.iter())
            .map(|(doc, kind)| pending_document(doc, *kind, false))
            .collect();
        return Ok(LegalStatus {
            prompt: Some(LegalPrompt { first_time, documents }),
            notice: None,
        });
    }

    Ok(LegalStatus {
        prompt: None,
        notice: outdated_notice
            .first()
            .map(|(doc, kind)| pending_document(doc, *kind, false)),
    })
}

#[command]
pub async fn acknowledge_legal_documents() -> Result<()> {
    acknowledge_where(|_| true).await
}

#[command]
pub async fn acknowledge_legal_notice() -> Result<()> {
    acknowledge_where(|kind| kind == LegalDocumentKind::Notice).await
}
