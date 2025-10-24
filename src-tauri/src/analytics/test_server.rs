use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Debug, Clone)]
pub struct ReceivedRequest {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

pub struct TestServer {
    addr: SocketAddr,
    received: Arc<Mutex<Vec<ReceivedRequest>>>,
}

impl TestServer {
    pub async fn start() -> Result<Self, Box<dyn std::error::Error>> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;
        let received = Arc::new(Mutex::new(Vec::new()));
        
        let received_clone = Arc::clone(&received);
        tokio::spawn(async move {
            Self::run_server(listener, received_clone).await;
        });

        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        
        println!("Test server started on: http://{}", addr);
        
        Ok(Self { addr, received })
    }

    async fn run_server(listener: TcpListener, received: Arc<Mutex<Vec<ReceivedRequest>>>) {
        loop {
            match listener.accept().await {
                Ok((mut socket, _)) => {
                    let received = Arc::clone(&received);
                    tokio::spawn(async move {
                        let mut buffer = vec![0u8; 8192];
                        
                        match socket.read(&mut buffer).await {
                            Ok(n) if n > 0 => {
                                let request_str = String::from_utf8_lossy(&buffer[..n]);

                                let lines: Vec<&str> = request_str.lines().collect();
                                if lines.is_empty() {
                                    return;
                                }

                                let parts: Vec<&str> = lines[0].split_whitespace().collect();
                                if parts.len() < 2 {
                                    return;
                                }
                                
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

                                let req = ReceivedRequest {
                                    method: method.clone(),
                                    path: path.clone(),
                                    headers,
                                    body: body.clone(),
                                };

                                println!("\nRequest received:");
                                println!("   Method: {}", method);
                                println!("   Path: {}", path);
                                println!("   Body: {}", if body.len() > 100 {
                                    format!("{}... ({} bytes)", &body[..100], body.len())
                                } else {
                                    body.clone()
                                });
                                
                                received.lock().unwrap().push(req);

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
    }

    pub fn url(&self) -> String {
        format!("http://{}", self.addr)
    }

    pub fn endpoint(&self) -> String {
        format!("{}/api/track", self.url())
    }

    pub fn received_requests(&self) -> Vec<ReceivedRequest> {
        self.received.lock().unwrap().clone()
    }

    pub fn request_count(&self) -> usize {
        self.received.lock().unwrap().len()
    }

    pub fn last_request(&self) -> Option<ReceivedRequest> {
        self.received.lock().unwrap().last().cloned()
    }

    pub fn clear(&self) {
        self.received.lock().unwrap().clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analytics::{AnalyticsConfig, AnalyticsManager, PayloadFormat};
    use std::collections::HashMap;
    use serde_json::json;
    
    #[tokio::test]
    async fn test_server_receives_analytics_events() {
        let server = TestServer::start().await.unwrap();
        println!("Test server URL: {}", server.url());

        let config = AnalyticsConfig {
            enabled: true,
            endpoint_url: server.endpoint(),
            headers: {
                let mut h = HashMap::new();
                h.insert("X-Test-Header".to_string(), "test-value".to_string());
                h
            },
            payload_format: PayloadFormat::BatchArray,
            batch_size: 2,
            batch_interval_secs: 1,
            enable_retry: false,
            max_retries: 0,
            request_timeout_secs: 5,
        };
        
        let temp_dir = std::env::temp_dir().join("analytics_test");
        let manager = AnalyticsManager::new(config, temp_dir);

        manager.track("test_event_1");
        manager.track("test_event_2");

        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        assert!(server.request_count() > 0, "Server should have received at least one request");
        
        let last_req = server.last_request().unwrap();
        println!("\nRequest received:");
        println!("   Method: {}", last_req.method);
        println!("   Path: {}", last_req.path);
        println!("   Body: {}", last_req.body);

        let parsed: serde_json::Value = serde_json::from_str(&last_req.body).unwrap();
        println!("   Parsed JSON: {}", serde_json::to_string_pretty(&parsed).unwrap());

        assert!(parsed.get("events").is_some(), "Payload should contain 'events'");
        let events = parsed["events"].as_array().unwrap();
        assert!(events.len() >= 2, "Should contain at least 2 events");
    }
    
    #[tokio::test]
    async fn test_custom_wrapper_format() {
        let server = TestServer::start().await.unwrap();
        
        let mut wrapper_fields = HashMap::new();
        wrapper_fields.insert("version".to_string(), json!("1.0"));
        wrapper_fields.insert("client".to_string(), json!("test_client"));
        
        let config = AnalyticsConfig {
            enabled: true,
            endpoint_url: server.endpoint(),
            headers: HashMap::new(),
            payload_format: PayloadFormat::CustomWrapper {
                events_key: "data".to_string(),
                wrapper_fields,
            },
            batch_size: 1,
            batch_interval_secs: 1,
            enable_retry: false,
            max_retries: 0,
            request_timeout_secs: 5,
        };
        
        let temp_dir = std::env::temp_dir().join("analytics_test_custom");
        let manager = AnalyticsManager::new(config, temp_dir);
        manager.track("custom_test");
        
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        
        let last_req = server.last_request().unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&last_req.body).unwrap();
        
        println!("\nCustom Wrapper Payload:");
        println!("{}", serde_json::to_string_pretty(&parsed).unwrap());

        assert_eq!(parsed["version"], "1.0");
        assert_eq!(parsed["client"], "test_client");
        assert!(parsed.get("data").is_some());
    }
    
    #[tokio::test]
    async fn test_event_with_properties() {
        let server = TestServer::start().await.unwrap();
        
        let config = AnalyticsConfig {
            enabled: true,
            endpoint_url: server.endpoint(),
            headers: HashMap::new(),
            payload_format: PayloadFormat::BatchArray,
            batch_size: 1,
            batch_interval_secs: 1,
            enable_retry: false,
            max_retries: 0,
            request_timeout_secs: 5,
        };
        
        let temp_dir = std::env::temp_dir().join("analytics_test_props");
        let manager = AnalyticsManager::new(config, temp_dir);

        manager.event("mod_installed")
            .property("source", "modrinth")
            .property("mod_id", "abc123")
            .property("version", "1.2.3")
            .send();
        
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        
        let last_req = server.last_request().unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&last_req.body).unwrap();
        
        println!("\nEvent with properties:");
        println!("{}", serde_json::to_string_pretty(&parsed).unwrap());
        
        let events = parsed["events"].as_array().unwrap();
        let event = &events[0];
        
        assert_eq!(event["name"], "mod_installed");
        assert_eq!(event["properties"]["source"], "modrinth");
        assert_eq!(event["properties"]["mod_id"], "abc123");
        assert_eq!(event["properties"]["version"], "1.2.3");
    }
}

