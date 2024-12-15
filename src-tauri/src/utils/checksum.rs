use anyhow::Result;
use sha1::{Digest, Sha1};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::{fs, io};

pub fn sha1sum(path: &PathBuf) -> Result<String> {
    // get sha1 of library file and check if it matches
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha1::new();
    std::io::copy(&mut file, &mut hasher)?;
    let hash = hasher.finalize();
    let hex_hash = base16ct::lower::encode_string(&hash);

    Ok(hex_hash)
}

pub fn md5sum(file_path: &Path) -> Result<String> {
    let file = fs::File::open(file_path)?;

    let mut context = md5::Context::new();
    let mut buffer = [0; 4096]; // buffer size: 4KB
    let mut reader = io::BufReader::new(file);

    loop {
        let bytes_read = reader.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        context.consume(&buffer[..bytes_read]);
    }

    let result = context.compute();

    Ok(format!("{:x}", result))
}
