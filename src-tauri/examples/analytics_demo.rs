use noriskclient_launcher_v3_lib::analytics::{
    AnalyticsConfig, AnalyticsManager, PayloadFormat,
};
use std::collections::HashMap;
use serde_json::json;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("Analytics Demo - Live Test\n");
    
    println!("Starting local test server...");
    let server = start_demo_server().await?;
    println!("Server running on: {}\n", server.url);

    println!("Configuring analytics...");
    let config = AnalyticsConfig {
        enabled: true,
        endpoint_url: format!("{}/api/track", server.url),
        headers: {
            let mut h = HashMap::new();
            h.insert("X-API-Key".to_string(), "demo-key-123".to_string());
            h.insert("X-Client-Version".to_string(), "3.0.0".to_string());
            h
        },
        payload_format: PayloadFormat::CustomWrapper {
            events_key: "events".to_string(),
            wrapper_fields: {
                let mut w = HashMap::new();
                w.insert("version".to_string(), json!("1.0"));
                w.insert("launcher_version".to_string(), json!("3.0.0"));
                w.insert("platform".to_string(), json!(std::env::consts::OS));
                w
            },
        },
        batch_size: 3,
        batch_interval_secs: 5,
        enable_retry: true,
        max_retries: 2,
        request_timeout_secs: 10,
    };
    
    let manager = AnalyticsManager::new(config);
    println!("Analytics manager initialized\n");

    println!("Sending demo events...\n");

    println!("   [1] launcher_started");
    manager.track("launcher_started");
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    println!("   [2] profile_launched");
    manager.event("profile_launched")
        .property("game_version", "1.21.4")
        .property("loader", "fabric")
        .property("loader_version", "0.16.0")
        .property("mod_count", 42)
        .send();
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    println!("   [3] mod_installed");
    manager.event("mod_installed")
        .property("source", "modrinth")
        .property("project_id", "AANobbMI")
        .property("version_id", "tFw0iWAk")
        .property("mod_name", "Sodium")
        .send();

    println!("\nWaiting for batch send (batch_size=3)...");
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
    
    println!("\nDemo completed!");
    println!("Server received {} requests", server.request_count.lock().unwrap().len());

    println!("\nReceived Requests:");
    for (i, req) in server.request_count.lock().unwrap().iter().enumerate() {
        println!("\n   Request {}:", i + 1);
        println!("   Method: {}", req.method);
        println!("   Path: {}", req.path);
        println!("   Headers:");
        for (key, value) in &req.headers {
            println!("      {}: {}", key, value);
        }
        println!("   Body:");

        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&req.body) {
            println!("   {}", serde_json::to_string_pretty(&json).unwrap());
        } else {
            println!("   {}", req.body);
        }
    }
    
    println!("\nDemo completed successfully!");
    
    Ok(())
}

struct DemoServer {
    url: String,
    request_count: std::sync::Arc<std::sync::Mutex<Vec<Request>>>,
}

#[derive(Debug, Clone)]
struct Request {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: String,
}

async fn start_demo_server() -> Result<DemoServer, Box<dyn std::error::Error>> {
    use tokio::net::TcpListener;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    let url = format!("http://{}", addr);
    
    let request_count = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let request_count_clone = request_count.clone();
    
    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((mut socket, _)) => {
                    let request_count = request_count_clone.clone();
                    tokio::spawn(async move {
                        let mut buffer = vec![0u8; 16384];
                        
                        match socket.read(&mut buffer).await {
                            Ok(n) if n > 0 => {
                                let request_str = String::from_utf8_lossy(&buffer[..n]);
                                let lines: Vec<&str> = request_str.lines().collect();
                                
                                if !lines.is_empty() {
                                    let parts: Vec<&str> = lines[0].split_whitespace().collect();
                                    if parts.len() >= 2 {
                                        let method = parts[0].to_string();
                                        let path = parts[1].to_string();
                                        
                                        let mut headers = Vec::new();
                                        let mut body_start = 0;
                                        for (i, line) in lines.iter().enumerate().skip(1) {
                                            if line.is_empty() {
                                                body_start = i + 1;
                                                break;
                                            }
                                            if let Some(colon_pos) = line.find(':') {
                                                let key = line[..colon_pos].trim().to_string();
                                                let value = line[colon_pos + 1..].trim().to_string();
                                                headers.push((key, value));
                                            }
                                        }
                                        
                                        let body = if body_start < lines.len() {
                                            lines[body_start..].join("\n")
                                        } else {
                                            String::new()
                                        };
                                        
                                        println!("\n[Server] Request received: {} {}", method, path);
                                        
                                        request_count.lock().unwrap().push(Request {
                                            method,
                                            path,
                                            headers,
                                            body,
                                        });
                                    }
                                }
                                
                                let response = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK";
                                let _ = socket.write_all(response.as_bytes()).await;
                            }
                            _ => {}
                        }
                    });
                }
                Err(_) => break,
            }
        }
    });
    
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    
    Ok(DemoServer {
        url,
        request_count,
    })
}

