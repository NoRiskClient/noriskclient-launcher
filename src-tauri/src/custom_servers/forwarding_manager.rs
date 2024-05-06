use std::sync::atomic::{AtomicBool, Ordering};
use std::{io, thread};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::thread::sleep;
use anyhow::Result;
use jsonwebtoken::{Algorithm, encode, EncodingKey, Header};

use log::info;
use serde::{Deserialize, Serialize};
use tokio::sync::oneshot::Receiver;

use crate::app::api::ApiEndpoints;

use super::models::CustomServer;

#[derive(Debug, Serialize)]
struct NewConnectionClaims {
    subdomain: String,
    basedomain: String,
    #[serde(rename = "connectionId")]
    connection_id: String,
}

fn handle_receive(mut stream: TcpStream, custom_server: CustomServer, private_key: String) {
    loop {
        let server = custom_server.clone();
        let key = private_key.clone();
        let mut buffer = [0; 128];
        let bytes_read = stream.read(&mut buffer);
        let Some(bytes_read) = bytes_read.ok() else { continue; };
        if buffer[0] == 0x00u8 {
            println!("Received heartbeat");
        } else if buffer[0] == 0x01u8 {
            println!("Received message to forward");
            thread::spawn(move || {
                open_new_connection(&buffer[1..bytes_read], &server, &key)
            });
        } else {
            println!("Received unknown message: {:?}", &buffer[..bytes_read])
        }
    }
}

fn forward(src: TcpStream, dest: TcpStream) -> io::Result<()> {
    let mut src = src;
    let mut dest = dest;
    let mut buffer = [0; 1024];
    loop {
        let bytes_read = src.read(&mut buffer)?;
        if bytes_read == 0 {
            return Ok(());
        }
        dest.write_all(&buffer[..bytes_read])?;
    }
}

fn open_new_connection(x: &[u8], custom_server: &CustomServer, private_key: &String) -> io::Result<()> {
    let id = String::from_utf8_lossy(x);

    println!("Opening new connection for id: {}", id);

    let mut host_conn = TcpStream::connect("135.181.46.40:4444")?;
    let mc_conn = TcpStream::connect("127.0.0.1:25565")?;

    let mut prefix = 0x11u8.to_be_bytes().to_vec();

    // Use the private key which we got from the API to sign the token
    let ecdsa_private_key = private_key;
    
    // Replace with the values we got from the API
    let claims = NewConnectionClaims {
        subdomain: custom_server.subdomain.to_string(),
        basedomain: custom_server.domain.to_string(),
        connection_id: id.to_string(),
    };
    let header = Header::new(Algorithm::ES256);
    let token = encode(&header, &claims, &EncodingKey::from_ec_pem(ecdsa_private_key.as_bytes()).expect("Failed to create encoding key from ECDSA key"))
        .expect("Failed to encode claims to token");

    prefix.extend(token.as_bytes().to_vec());
    info!("Sending new connection prefix: {:?}", prefix);
    host_conn.write_all(&prefix)?;

    let host_conn_clone = host_conn.try_clone()?;
    let mc_conn_clone = mc_conn.try_clone()?;

    let host_to_mc = thread::spawn(move || forward(host_conn, mc_conn_clone));
    let mc_to_host = thread::spawn(move || forward(mc_conn, host_conn_clone));

    let _ = host_to_mc.join();
    let _ = mc_to_host.join();

    Ok(())
}

pub async fn start_forwarding(custom_server: CustomServer, token: String, running_state: Arc<AtomicBool>) -> Result<(), String> {
    let tokens: GetTokenResponse = ApiEndpoints::request_from_norisk_endpoint(&format!("custom-servers/{}/token", &custom_server.id), &token).await.map_err(|err| format!("Failed to get token: {}", err))?;

    let stream = TcpStream::connect("135.181.46.40:4444").map_err(|err| format!("Failed to connect to forwarding server: {}", err))?;
    let shared_stream = Arc::new(Mutex::new(stream));
    println!("Connected to server.");

    //Replace with the token we got from the API
    let message_to_send = tokens.jwt.as_bytes().to_vec();
    let mut prefix = 0x10u8.to_be_bytes().to_vec();

    prefix.extend(message_to_send);

    let receive_handle = {
        let shared_stream = Arc::clone(&shared_stream);
        thread::spawn(move || {
            handle_receive(shared_stream.lock().unwrap().try_clone().expect("Failed to clone stream"), custom_server.clone(), tokens.private_key.clone())
        })
    };

    shared_stream.lock().unwrap().write_all(&prefix).map_err(|err| format!("Failed to send message to server: {}", err))?;

    receive_handle.join().expect("Receive thread panicked");

    // Keep the main thread alive
    while running_state.load(Ordering::SeqCst) {
        sleep(std::time::Duration::from_secs(1));
    }

    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
struct GetTokenResponse {
    jwt: String,
    #[serde(rename = "privateKey")]
    private_key: String,
}