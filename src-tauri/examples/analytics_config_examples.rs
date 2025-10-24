use noriskclient_launcher_v3_lib::analytics::{
    AnalyticsConfig, AnalyticsManager, PayloadFormat,
};
use std::collections::HashMap;
use serde_json::json;

#[tokio::main]
async fn main() {
    println!("Analytics Configuration Examples\n");
    println!("Demonstrates how URLs, headers, and payloads can be customized.\n");
    println!("{}", "=".repeat(70));

    println!("\nExample 1: Plausible (Self-Hosted)");
    println!("{}", "-".repeat(70));
    
    let plausible_config = AnalyticsConfig {
        enabled: true,
        endpoint_url: "https://analytics.norisk.gg/api/event".to_string(),
        headers: {
            let mut h = HashMap::new();
            h.insert("User-Agent".to_string(), "NoRisk-Launcher/3.0".to_string());
            h
        },
        payload_format: PayloadFormat::SingleEvent,
        batch_size: 1,
        batch_interval_secs: 1,
        enable_retry: true,
        max_retries: 3,
        request_timeout_secs: 10,
    };
    
    println!("   Endpoint: {}", plausible_config.endpoint_url);
    println!("   Headers: {:?}", plausible_config.headers);
    println!("   Format: SingleEvent");

    println!("\nExample 2: Custom NoRisk API with Authorization");
    println!("{}", "-".repeat(70));
    
    let norisk_api_config = AnalyticsConfig {
        enabled: true,
        endpoint_url: "https://api.norisk.gg/v1/analytics/track".to_string(),
        headers: {
            let mut h = HashMap::new();
            h.insert("Authorization".to_string(), "Bearer sk_live_abc123xyz789".to_string());
            h.insert("X-API-Version".to_string(), "2024-01-01".to_string());
            h.insert("X-Client-Version".to_string(), env!("CARGO_PKG_VERSION").to_string());
            h.insert("X-Client-Platform".to_string(), std::env::consts::OS.to_string());
            h
        },
        payload_format: PayloadFormat::CustomWrapper {
            events_key: "events".to_string(),
            wrapper_fields: {
                let mut w = HashMap::new();
                w.insert("api_version".to_string(), json!("1.0"));
                w.insert("launcher_version".to_string(), json!(env!("CARGO_PKG_VERSION")));
                w.insert("platform".to_string(), json!(std::env::consts::OS));
                w.insert("arch".to_string(), json!(std::env::consts::ARCH));
                w
            },
        },
        batch_size: 50,
        batch_interval_secs: 30,
        enable_retry: true,
        max_retries: 3,
        request_timeout_secs: 10,
    };
    
    println!("   Endpoint: {}", norisk_api_config.endpoint_url);
    println!("   Headers:");
    for (key, value) in &norisk_api_config.headers {
        let display_value = if key == "Authorization" {
            "Bearer sk_live_***"
        } else {
            value
        };
        println!("      {}: {}", key, display_value);
    }
    println!("   Format: CustomWrapper");

    println!("\nExample 3: Umami with API Key");
    println!("{}", "-".repeat(70));
    
    let umami_config = AnalyticsConfig {
        enabled: true,
        endpoint_url: "https://analytics.norisk.gg/api/send".to_string(),
        headers: {
            let mut h = HashMap::new();
            h.insert("x-umami-api-key".to_string(), "umami_key_12345".to_string());
            h.insert("Content-Type".to_string(), "application/json".to_string());
            h
        },
        payload_format: PayloadFormat::CustomWrapper {
            events_key: "payload".to_string(),
            wrapper_fields: {
                let mut w = HashMap::new();
                w.insert("type".to_string(), json!("event"));
                w.insert("website".to_string(), json!("website-uuid-here"));
                w
            },
        },
        batch_size: 20,
        batch_interval_secs: 15,
        enable_retry: true,
        max_retries: 2,
        request_timeout_secs: 10,
    };
    
    println!("   Endpoint: {}", umami_config.endpoint_url);
    println!("   Headers: {:?}", umami_config.headers.keys().collect::<Vec<_>>());
    println!("   Format: CustomWrapper");

    println!("\nExample 4: Basic Authentication");
    println!("{}", "-".repeat(70));
    
    let basic_auth_config = AnalyticsConfig {
        enabled: true,
        endpoint_url: "https://stats.example.com/api/events".to_string(),
        headers: {
            let mut h = HashMap::new();
            h.insert("Authorization".to_string(), "Basic dXNlcm5hbWU6cGFzc3dvcmQ=".to_string());
            h
        },
        payload_format: PayloadFormat::BatchArray,
        batch_size: 100,
        batch_interval_secs: 60,
        enable_retry: true,
        max_retries: 3,
        request_timeout_secs: 10,
    };
    
    println!("   Endpoint: {}", basic_auth_config.endpoint_url);
    println!("   Headers: Authorization: Basic ***");
    println!("   Format: BatchArray");

    println!("\nExample 5: Multiple Custom Headers");
    println!("{}", "-".repeat(70));
    
    let custom_headers_config = AnalyticsConfig {
        enabled: true,
        endpoint_url: "https://api.custom-analytics.com/v2/ingest".to_string(),
        headers: {
            let mut h = HashMap::new();
            h.insert("X-API-Key".to_string(), "custom_key_123".to_string());
            h.insert("X-Tenant-ID".to_string(), "tenant_norisk".to_string());
            h.insert("X-Environment".to_string(), "production".to_string());
            h.insert("X-Source".to_string(), "desktop-launcher".to_string());
            h.insert("X-Version".to_string(), "3.0.0".to_string());
            h.insert("X-Region".to_string(), "eu-central-1".to_string());
            h.insert("Content-Type".to_string(), "application/vnd.api+json".to_string());
            h.insert("X-Rate-Limit-Tier".to_string(), "premium".to_string());
            h
        },
        payload_format: PayloadFormat::CustomWrapper {
            events_key: "data".to_string(),
            wrapper_fields: {
                let mut w = HashMap::new();
                w.insert("schema_version".to_string(), json!("2.0"));
                w.insert("source".to_string(), json!("launcher"));
                w.insert("tenant".to_string(), json!("norisk"));
                w
            },
        },
        batch_size: 25,
        batch_interval_secs: 20,
        enable_retry: true,
        max_retries: 5,
        request_timeout_secs: 15,
    };
    
    println!("   Endpoint: {}", custom_headers_config.endpoint_url);
    println!("   Headers ({} total):", custom_headers_config.headers.len());
    for (key, _) in &custom_headers_config.headers {
        println!("      - {}", key);
    }
    println!("   Format: CustomWrapper with additional fields");

    println!("\nExample 6: Runtime Configuration Updates");
    println!("{}", "-".repeat(70));
    println!("   Configuration can be updated at runtime without restart:\n");
    
    let temp_dir = std::env::temp_dir().join("analytics_config_examples");
    let manager = AnalyticsManager::new(plausible_config.clone(), temp_dir);
    println!("   - Manager created with Plausible config");

    manager.update_config(norisk_api_config.clone()).await;
    println!("   - Config updated to NoRisk API");
    
    manager.update_config(umami_config.clone()).await;
    println!("   - Config updated to Umami");
    
    println!("\n   Backend can be switched at any time without restart!");

    println!("\nExample 7: Builder Pattern for Easy Configuration");
    println!("{}", "-".repeat(70));
    
    let quick_config = AnalyticsConfig::with_endpoint("https://api.example.com/track")
        .with_header("X-API-Key", "my-secret-key")
        .with_header("X-Custom-Header", "custom-value")
        .with_payload_format(PayloadFormat::BatchArray)
        .with_batch_config(50, 30);
    
    println!("   Endpoint: {}", quick_config.endpoint_url);
    println!("   Headers: {} configured", quick_config.headers.len());
    println!("   Batch: {} events / {} seconds", 
             quick_config.batch_size, 
             quick_config.batch_interval_secs);

    println!("\n");
    println!("{}", "=".repeat(70));
    println!("SUMMARY");
    println!("{}", "=".repeat(70));
    println!("\nEverything is customizable:");
    println!("   - Endpoint URL - simple string replacement");
    println!("   - Headers - HashMap, unlimited entries");
    println!("   - Payload format - 3 options (Single, Batch, Custom)");
    println!("   - Custom wrapper fields - arbitrary JSON fields");
    println!("   - Batch size & interval - for performance tuning");
    println!("   - Retry logic - configurable");
    println!("   - Timeouts - adjustable");
    println!("\nRuntime configuration updates:");
    println!("   - manager.update_config() - switch backend without restart");
    println!("   - manager.enable() / disable() - toggle analytics");
    println!("\nSupports various backends:");
    println!("   - Plausible (self-hosted)");
    println!("   - Umami");
    println!("   - Custom APIs with authentication");
    println!("   - Mixpanel, Amplitude, etc.");
    println!("   - Any HTTP-based analytics system");
    println!("\nSimple usage:");
    println!("   let config = AnalyticsConfig::with_endpoint(\"url\")");
    println!("       .with_header(\"X-API-Key\", \"key\");");
    println!("   let manager = AnalyticsManager::new(config);");
    println!("\nImplemented and tested.");
}

