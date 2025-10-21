
### 1. Create Configuration

```rust
use crate::analytics::{AnalyticsConfig, PayloadFormat};

let config = AnalyticsConfig::with_endpoint("https://api.example.com/track")
    .with_header("Authorization", "Bearer YOUR_TOKEN")
    .with_header("X-API-Key", "your-api-key")
    .with_batch_config(50, 30); // 50 events, 30 seconds
```

### 2. Initialize Manager

```rust
use crate::analytics::AnalyticsManager;

let manager = AnalyticsManager::new(config);
```

### 3. Track Events

```rust
// Simple event
manager.track("launcher_started");

// Event with properties
let mut props = HashMap::new();
props.insert("version".to_string(), json!("1.21.4"));
manager.track_with_props("profile_launched", props);

// Fluent builder API
manager.event("mod_installed")
    .property("source", "modrinth")
    .property("mod_id", "abc123")
    .send();
```

## Configuration Options

### Payload Formats

**SingleEvent** - One event per HTTP request
```json
{
  "name": "profile_launched",
  "timestamp": 1704067200,
  "properties": {...}
}
```

**BatchArray** - Multiple events in array (default)
```json
{
  "events": [
    { "name": "profile_launched", ... },
    { "name": "mod_installed", ... }
  ]
}
```

**CustomWrapper** - Flexible format with custom fields
```rust
PayloadFormat::CustomWrapper {
    events_key: "data".to_string(),
    wrapper_fields: {
        let mut w = HashMap::new();
        w.insert("version".to_string(), json!("1.0"));
        w.insert("launcher_version".to_string(), json!("3.0.0"));
        w
    }
}
```

Output:
```json
{
  "version": "1.0",
  "launcher_version": "3.0.0",
  "data": [ ... events ... ]
}
```

### Custom Headers

Headers are configured via HashMap for maximum flexibility:

```rust
let mut headers = HashMap::new();
headers.insert("Authorization".to_string(), "Bearer token".to_string());
headers.insert("X-API-Version".to_string(), "2024-01-01".to_string());
headers.insert("X-Client-Version".to_string(), "3.0.0".to_string());
```

## Integration Examples

### Profile Launch Tracking

```rust
#[tauri::command]
pub async fn launch_profile(id: Uuid, ...) -> Result<(), CommandError> {
    let state = State::get().await?;
    let profile = state.profile_manager.get_profile(id).await?;
    
    state.analytics_manager.event("profile_launched")
        .property("game_version", &profile.game_version)
        .property("loader", profile.loader.to_string())
        .property("mod_count", profile.mods.len())
        .send();
    
    // ... launch logic ...
}
```


### Custom API with Authentication

```rust
AnalyticsConfig {
    enabled: true,
    endpoint_url: "https://api.example.com/v1/analytics/track".to_string(),
    headers: {
        let mut h = HashMap::new();
        h.insert("Authorization".to_string(), "Bearer token".to_string());
        h.insert("X-API-Version".to_string(), "2024-01-01".to_string());
        h
    },
    payload_format: PayloadFormat::BatchArray,
    batch_size: 50,
    batch_interval_secs: 30,
    enable_retry: true,
    max_retries: 3,
    request_timeout_secs: 10,
}
```

## Runtime Configuration

Configuration can be updated without restarting:

```rust
// Update entire configuration
manager.update_config(new_config).await;

// Enable/disable analytics
manager.enable().await;
manager.disable().await;

// Check status
if manager.is_enabled().await {
    // ...
}
```

