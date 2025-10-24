use crate::analytics::AnalyticsStats;
use crate::error::{AppError, CommandError};
use crate::state::state_manager::State;
use log::info;

#[tauri::command]
pub async fn get_analytics_stats() -> Result<AnalyticsStats, CommandError> {
    info!("[Analytics API] get_analytics_stats called");

    let state = State::get().await?;
    let storage = state.analytics_manager.get_storage();

    let stats = storage
        .get_stats()
        .await
        .map_err(|e| AppError::Unknown(format!("Failed to get analytics stats: {}", e)))?;

    info!(
        "[Analytics API] Returning stats: {} total events, {} unique event types",
        stats.total_events,
        stats.events_by_name.len()
    );

    Ok(stats)
}

#[tauri::command]
pub async fn get_analytics_event_count() -> Result<usize, CommandError> {
    info!("[Analytics API] get_analytics_event_count called");

    let state = State::get().await?;
    let storage = state.analytics_manager.get_storage();

    let count = storage
        .get_event_count()
        .await
        .map_err(|e| AppError::Unknown(format!("Failed to get event count: {}", e)))?;

    info!("[Analytics API] Total events: {}", count);

    Ok(count)
}

#[tauri::command]
pub async fn get_all_analytics_events() -> Result<Vec<crate::analytics::AnalyticsEvent>, CommandError> {
    info!("[Analytics API] get_all_analytics_events called");

    let state = State::get().await?;
    let storage = state.analytics_manager.get_storage();

    let events = storage
        .get_all_events()
        .await
        .map_err(|e| AppError::Unknown(format!("Failed to get events: {}", e)))?;

    info!("[Analytics API] Returning {} events", events.len());

    Ok(events)
}

