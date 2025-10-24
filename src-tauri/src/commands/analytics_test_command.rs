use crate::error::CommandError;
use crate::state::state_manager::State;
use log::info;

#[tauri::command]
pub async fn test_analytics_event(
    event_name: String,
    test_property: Option<String>,
) -> Result<String, CommandError> {
    info!("======================================");
    info!("[TEST] test_analytics_event command called!");
    info!("[TEST] Event name: {}", event_name);
    info!("[TEST] Test property: {:?}", test_property);
    info!("======================================");
    
    let state = State::get().await?;
    
    if let Some(prop_value) = test_property {
        state.analytics_manager.event(&event_name)
            .property("test_property", prop_value.clone())
            .property("manual_trigger", true)
            .send();
        
        info!("[TEST] Analytics event '{}' sent with property: {}", event_name, prop_value);
        Ok(format!("Analytics event '{}' sent with property: {}", event_name, prop_value))
    } else {
        state.analytics_manager.track(&event_name);
        info!("[TEST] Analytics event '{}' sent (no properties)", event_name);
        Ok(format!("Analytics event '{}' sent (no properties)", event_name))
    }
}

