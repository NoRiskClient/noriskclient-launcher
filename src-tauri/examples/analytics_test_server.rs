use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex;

#[derive(Debug, Clone)]
struct ReceivedEvent {
    timestamp: String,
    body: String,
}

#[derive(Debug, Clone, serde::Serialize)]
struct VersionStats {
    version: String,
    count: u32,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("Analytics Test Server\n");
    println!("Start the launcher and launch a profile to see events...\n");
    println!("{}", "=".repeat(70));

    let listener = TcpListener::bind("127.0.0.1:9090").await?;
    let addr = listener.local_addr()?;
    let events: Arc<Mutex<Vec<ReceivedEvent>>> = Arc::new(Mutex::new(Vec::new()));

    println!("\nServer started successfully!");
    println!("Listening on: http://{}/api/track", addr);
    println!("\nWaiting for analytics events from launcher...\n");

    loop {
        match listener.accept().await {
            Ok((mut socket, addr)) => {
                let events = Arc::clone(&events);
                tokio::spawn(async move {
                    let mut buffer = vec![0u8; 16384];

                    match socket.read(&mut buffer).await {
                        Ok(n) if n > 0 => {
                            let request_str = String::from_utf8_lossy(&buffer[..n]);
                            let lines: Vec<&str> = request_str.lines().collect();

                            if !lines.is_empty() {
                                let parts: Vec<&str> = lines[0].split_whitespace().collect();
                                if parts.len() >= 2 {
                                    let method = parts[0];
                                    let path = parts[1];

                                    let mut body_start = 0;
                                    for (i, line) in lines.iter().enumerate().skip(1) {
                                        if line.is_empty() {
                                            body_start = i + 1;
                                            break;
                                        }
                                    }

                                    let body = if body_start < lines.len() {
                                        lines[body_start..].join("\n")
                                    } else {
                                        String::new()
                                    };

                                    // Handle health endpoint
                                    if path == "/api/health" {
                                        let response_body = "{\"success\": true}";
                                        let response = format!(
                                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\n\r\n{}",
                                            response_body.len(),
                                            response_body
                                        );
                                        let _ = socket.write_all(response.as_bytes()).await;
                                        return;
                                    }

                                    // Handle stats endpoints
                                    if path.starts_with("/stats/") {
                                        let events_lock = events.lock().await;
                                        let response_body = if path == "/stats/count" {
                                            format!("{{\"count\": {}}}", events_lock.len())
                                        } else if path == "/stats/events" {
                                            let all_events: Vec<serde_json::Value> = events_lock
                                                .iter()
                                                .filter_map(|e| serde_json::from_str(&e.body).ok())
                                                .collect();
                                            serde_json::to_string(&all_events).unwrap_or_default()
                                        } else if path == "/stats/versions" {
                                            // Count Minecraft versions from profile_launched events
                                            let mut version_counts: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
                                            
                                            for event in events_lock.iter() {
                                                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&event.body) {
                                                    // Check if this is the new format with events array
                                                    if let Some(events_array) = json.get("events").and_then(|v| v.as_array()) {
                                                        for event_item in events_array {
                                                            if let Some(event_name) = event_item.get("name").and_then(|v| v.as_str()) {
                                                                if event_name == "profile_launched" {
                                                                    if let Some(properties) = event_item.get("properties") {
                                                                        if let Some(game_version) = properties.get("game_version").and_then(|v| v.as_str()) {
                                                                            *version_counts.entry(game_version.to_string()).or_insert(0) += 1;
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                    // Fallback for old format
                                                    else if let Some(event_type) = json.get("event").and_then(|v| v.as_str()) {
                                                        if event_type == "profile_launched" {
                                                            if let Some(data) = json.get("data") {
                                                                if let Some(game_version) = data.get("game_version").and_then(|v| v.as_str()) {
                                                                    *version_counts.entry(game_version.to_string()).or_insert(0) += 1;
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                            
                                            let version_stats: Vec<VersionStats> = version_counts
                                                .into_iter()
                                                .map(|(version, count)| VersionStats { version, count })
                                                .collect();
                                            
                                            serde_json::to_string(&version_stats).unwrap_or_default()
                                        } else {
                                            "{\"error\":\"Not found\"}".to_string()
                                        };
                                        drop(events_lock);

                                        let response = format!(
                                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\n\r\n{}",
                                            response_body.len(),
                                            response_body
                                        );
                                        let _ = socket.write_all(response.as_bytes()).await;
                                        return;
                                    }

                                    if !body.is_empty() {
                                        let timestamp = chrono::Local::now().format("%H:%M:%S").to_string();
                                        
                                        println!("\n{}", "=".repeat(70));
                                        println!("[{}] Event received from {}", timestamp, addr);
                                        println!("{} {}", method, path);
                                        println!("{}", "-".repeat(70));

                                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                                            println!("{}", serde_json::to_string_pretty(&json).unwrap_or_default());
                                            
                                            // Extract event details
                                            if let Some(events_array) = json.get("events").and_then(|e| e.as_array()) {
                                                println!("\nEvent Summary:");
                                                for (i, event) in events_array.iter().enumerate() {
                                                    if let Some(name) = event.get("name").and_then(|n| n.as_str()) {
                                                        println!("  {}. Event: {}", i + 1, name);
                                                        
                                                        if let Some(props) = event.get("properties").and_then(|p| p.as_object()) {
                                                            for (key, value) in props {
                                                                println!("     - {}: {}", key, value);
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        } else {
                                            println!("{}", body);
                                        }

                                        events.lock().await.push(ReceivedEvent {
                                            timestamp,
                                            body,
                                        });

                                        let total = events.lock().await.len();
                                        println!("\nTotal events received: {}", total);
                                    }
                                }
                            }

                            let response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 15\r\n\r\n{\"success\":true}";
                            let _ = socket.write_all(response.as_bytes()).await;
                        }
                        _ => {}
                    }
                });
            }
            Err(e) => {
                eprintln!("Error accepting connection: {}", e);
            }
        }
    }
}

