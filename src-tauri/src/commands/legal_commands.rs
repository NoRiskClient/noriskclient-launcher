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
}

const LEGAL_DOCUMENTS: [(&str, LegalDocumentKind); 3] = [
    ("terms", LegalDocumentKind::Consent),
    ("privacy", LegalDocumentKind::Notice),
    ("licenses", LegalDocumentKind::Notice),
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

impl LegalPrompt {
    fn none() -> Self {
        Self {
            first_time: false,
            documents: Vec::new(),
        }
    }
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

fn is_known(doc: &LegalDocumentUpdate) -> bool {
    LEGAL_DOCUMENTS.iter().any(|(slug, _)| *slug == doc.slug)
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
    for doc in documents.iter().filter(|doc| is_known(doc)) {
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

fn accepted_before_legacy_cutoff(doc: &LegalDocumentUpdate) -> bool {
    doc.acknowledgement_updated_at
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
pub async fn get_pending_legal_documents(
    locale: String,
    accepted_legacy_terms: bool,
) -> Result<LegalPrompt> {
    let updates = match fetch_updates().await {
        Ok(updates) => updates,
        Err(e) => {
            warn!("Skipping the legal prompt, updates could not be fetched: {:?}", e);
            return Ok(LegalPrompt::none());
        }
    };

    let pool = pool().await?;
    let mut acknowledged = acknowledged_versions(&pool).await?;

    if acknowledged.is_empty() && accepted_legacy_terms {
        info!("Carrying over the terms accepted in an earlier launcher version");
        let carried: Vec<&LegalDocumentUpdate> =
            updates.iter().filter(|doc| accepted_before_legacy_cutoff(doc)).collect();
        store_versions(&pool, &carried).await?;
        acknowledged = acknowledged_versions(&pool).await?;
    }

    let first_time = acknowledged.is_empty();
    let documents: Vec<PendingLegalDocument> = LEGAL_DOCUMENTS
        .iter()
        .filter_map(|(slug, kind)| document_for(&updates, slug, &locale).map(|doc| (doc, *kind)))
        .filter(|(doc, _)| first_time || is_outdated(doc, &acknowledged))
        .map(|(doc, kind)| pending_document(doc, kind, first_time))
        .collect();

    if !documents.iter().any(|doc| doc.kind == LegalDocumentKind::Consent) {
        return Ok(LegalPrompt::none());
    }

    Ok(LegalPrompt { first_time, documents })
}

#[command]
pub async fn acknowledge_legal_documents() -> Result<()> {
    let updates = fetch_updates().await?;
    let documents: Vec<&LegalDocumentUpdate> = updates.iter().collect();
    store_versions(&pool().await?, &documents).await
}
