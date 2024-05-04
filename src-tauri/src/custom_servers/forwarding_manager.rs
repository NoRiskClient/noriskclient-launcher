use std::{io, thread};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::thread::sleep;
use jsonwebtoken::{Algorithm, encode, EncodingKey, Header};

use serde::Serialize;

#[derive(Debug, Serialize)]
struct NewConnectionClaims {
    subdomain: String,
    basedomain: String,
    #[serde(rename = "connectionId")]
    connection_id: String,
}

fn handle_receive(mut stream: TcpStream) {
    loop {
        let mut buffer = [0; 128];
        let bytes_read = stream.read(&mut buffer);
        let Some(bytes_read) = bytes_read.ok() else {
            continue;
        };
        if buffer[0] == 0x00u8 {
            println!("Received heartbeat");
        } else if buffer[0] == 0x01u8 {
            println!("Received message to forward");
            thread::spawn(move || {
                open_new_connection(&buffer[1..bytes_read])
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

fn open_new_connection(x: &[u8]) -> io::Result<()> {
    let id = String::from_utf8_lossy(x);

    println!("Opening new connection for id: {}", id);

    let mut host_conn = TcpStream::connect("127.0.0.1:4444")?;
    let mc_conn = TcpStream::connect("127.0.0.1:25566")?;

    let mut prefix = 0x11u8.to_be_bytes().to_vec();

    // Use the private key which we got from the API to sign the token
    let ecdsa_private_key = "-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQglBnO+qn+RecAQ31T
jBklNu+AwiFN5eVHBFbnjecmMryhRANCAARGpVef6j7rMQ6lYSwbDkKwH7B3zM6P
G7S4BIamIY/7Bh9xzW6fIzFxK1sPNSNG45tjwNqVoIn38npSuRCRkG1n
-----END PRIVATE KEY-----";
    
    // Replace with the values we got from the API
    let claims = NewConnectionClaims {
        subdomain: "mein-server".to_string(),
        basedomain: "norisk.gg".to_string(),
        connection_id: id.to_string(),
    };
    let header = Header::new(Algorithm::ES256);
    let token = encode(&header, &claims, &EncodingKey::from_ec_pem(ecdsa_private_key.as_bytes()).expect("Failed to create encoding key from ECDSA key"))
        .expect("Failed to encode claims to token");

    prefix.extend(token.as_bytes().to_vec());
    host_conn.write_all(&prefix)?;

    let host_conn_clone = host_conn.try_clone()?;
    let mc_conn_clone = mc_conn.try_clone()?;

    let host_to_mc = thread::spawn(move || forward(host_conn, mc_conn_clone));
    let mc_to_host = thread::spawn(move || forward(mc_conn, host_conn_clone));

    let _ = host_to_mc.join();
    let _ = mc_to_host.join();

    Ok(())
}

fn main() -> io::Result<()> {
    let stream = TcpStream::connect("127.0.0.1:4444")?;
    let shared_stream = Arc::new(Mutex::new(stream));
    println!("Connected to server.");

    //Replace with the token we got from the API
    let message_to_send = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJiYXNlZG9tYWluIjoibm9yaXNrLmdnIiwiaWF0IjoxNzEyNTExOTIyLCJpc3MiOiJOUkMtTGF1bmNoZXItQVBJIiwib3duZXIiOiI2MjVkZDIyYi1iYWQyLTRiODItYTBiYy1lNDNiYTFjMWE3ZmQiLCJwdWJsaWNrZXkiOiItLS0tLUJFR0lOIFBVQkxJQyBLRVktLS0tLVxuTUZrd0V3WUhLb1pJemowQ0FRWUlLb1pJemowREFRY0RRZ0FFUnFWWG4rbys2ekVPcFdFc0d3NUNzQit3ZDh6T1xuanh1MHVBU0dwaUdQK3dZZmNjMXVueU14Y1N0YkR6VWpSdU9iWThEYWxhQ0o5L0o2VXJrUWtaQnRadz09XG4tLS0tLUVORCBQVUJMSUMgS0VZLS0tLS1cbiIsInNlcnZlciI6IjYyZTY3YWVhLWMzZTUtNDRkOC1iMWIyLTljY2YyZjFiNWY0MyIsInN1YmRvbWFpbiI6Im1laW4tc2VydmVyIn0.BmFRSl8mXI3q3ifa3DQW59erja4z-C_l7SvvrH-2Y9k".as_bytes().to_vec();
    let mut prefix = 0x10u8.to_be_bytes().to_vec();

    prefix.extend(message_to_send);

    let receive_handle = {
        let shared_stream = Arc::clone(&shared_stream);
        thread::spawn(move || {
            handle_receive(shared_stream.lock().unwrap().try_clone().expect("Failed to clone stream"))
        })
    };

    shared_stream.lock().unwrap().write_all(&prefix)?;

    receive_handle.join().expect("Receive thread panicked");

    // Keep the main thread alive
    loop {
        sleep(std::time::Duration::from_secs(1));
    }
}