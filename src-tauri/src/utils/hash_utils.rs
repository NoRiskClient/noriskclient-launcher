use sha1::{Digest, Sha1};
use sha2::Sha256;
use std::io;
use std::path::{Path, PathBuf};
use tokio::fs::File;
use tokio::io::AsyncReadExt; // Import the trait for read()

const MURMUR2_M: u32 = 0x5bd1e995;
const MURMUR2_R: u32 = 24;
const CURSEFORGE_FINGERPRINT_SEED: u32 = 1;
const FINGERPRINT_READ_BUFFER: usize = 64 * 1024;
const HASH_READ_BUFFER: usize = 64 * 1024;

/// Asynchronously calculates the SHA1 hash of a file.
pub async fn calculate_sha1(path: &PathBuf) -> Result<String, io::Error> {
    hash_file_blocking::<Sha1>(path.clone()).await
}

async fn hash_file_blocking<D>(path: PathBuf) -> Result<String, io::Error>
where
    D: Digest + Send + 'static,
{
    tokio::task::spawn_blocking(move || hash_file_sync::<D>(&path))
        .await
        .map_err(|e| io::Error::other(format!("hash task failed: {e}")))?
}

fn hash_file_sync<D: Digest>(path: &Path) -> Result<String, io::Error> {
    use std::io::Read;

    let mut file = std::fs::File::open(path)?;
    let mut hasher = D::new();
    let mut buffer = vec![0u8; HASH_READ_BUFFER];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(hex_lower(&hasher.finalize()))
}

fn hex_lower(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Calculates the SHA1 hash of a byte slice.
pub fn calculate_sha1_from_bytes(bytes: &[u8]) -> String {
    hex_lower(&Sha1::digest(bytes))
}

/// Alias for calculate_sha1 to match the naming convention used in download_utils
pub async fn calculate_sha1_from_file<P: AsRef<Path>>(path: P) -> Result<String, io::Error> {
    calculate_sha1(&path.as_ref().to_path_buf()).await
}

/// Asynchronously calculates the SHA256 hash of a file.
pub async fn calculate_sha256_from_file<P: AsRef<Path>>(path: P) -> Result<String, io::Error> {
    hash_file_blocking::<Sha256>(path.as_ref().to_path_buf()).await
}

/// Calculates the SHA256 hash of a byte slice.
pub fn calculate_sha256_from_bytes(bytes: &[u8]) -> String {
    hex_lower(&Sha256::digest(bytes))
}

fn is_curseforge_stripped(byte: u8) -> bool {
    matches!(byte, 9 | 10 | 13 | 32)
}

struct Murmur2 {
    hash: u32,
    tail: [u8; 4],
    tail_len: usize,
}

impl Murmur2 {
    fn new(seed: u32, total_len: u32) -> Self {
        Self {
            hash: seed ^ total_len,
            tail: [0; 4],
            tail_len: 0,
        }
    }

    fn mix_block(&mut self, block: [u8; 4]) {
        let mut k = u32::from_le_bytes(block);
        k = k.wrapping_mul(MURMUR2_M);
        k ^= k >> MURMUR2_R;
        k = k.wrapping_mul(MURMUR2_M);

        self.hash = self.hash.wrapping_mul(MURMUR2_M);
        self.hash ^= k;
    }

    fn update(&mut self, chunk: &[u8]) {
        let mut rest = chunk;

        if self.tail_len > 0 {
            let take = (4 - self.tail_len).min(rest.len());
            self.tail[self.tail_len..self.tail_len + take].copy_from_slice(&rest[..take]);
            self.tail_len += take;
            rest = &rest[take..];

            if self.tail_len < 4 {
                return;
            }

            let block = self.tail;
            self.tail_len = 0;
            self.mix_block(block);
        }

        while rest.len() >= 4 {
            let mut block = [0u8; 4];
            block.copy_from_slice(&rest[..4]);
            self.mix_block(block);
            rest = &rest[4..];
        }

        self.tail[..rest.len()].copy_from_slice(rest);
        self.tail_len = rest.len();
    }

    fn finish(mut self) -> u32 {
        if self.tail_len == 3 {
            self.hash ^= (self.tail[2] as u32) << 16;
        }
        if self.tail_len >= 2 {
            self.hash ^= (self.tail[1] as u32) << 8;
        }
        if self.tail_len >= 1 {
            self.hash ^= self.tail[0] as u32;
            self.hash = self.hash.wrapping_mul(MURMUR2_M);
        }

        self.hash ^= self.hash >> 13;
        self.hash = self.hash.wrapping_mul(MURMUR2_M);
        self.hash ^= self.hash >> 15;
        self.hash
    }
}

pub fn curseforge_fingerprint_from_bytes(bytes: &[u8]) -> u64 {
    let filtered: Vec<u8> = bytes
        .iter()
        .copied()
        .filter(|byte| !is_curseforge_stripped(*byte))
        .collect();

    let mut hasher = Murmur2::new(CURSEFORGE_FINGERPRINT_SEED, filtered.len() as u32);
    hasher.update(&filtered);
    hasher.finish() as u64
}

pub async fn calculate_curseforge_fingerprint<P: AsRef<Path>>(path: P) -> Result<u64, io::Error> {
    let path = path.as_ref();
    let filtered_len = curseforge_filtered_length(path).await?;

    let mut file = File::open(path).await?;
    let mut buffer = vec![0u8; FINGERPRINT_READ_BUFFER];
    let mut filtered = Vec::with_capacity(FINGERPRINT_READ_BUFFER);
    let mut hasher = Murmur2::new(CURSEFORGE_FINGERPRINT_SEED, filtered_len);

    loop {
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            break;
        }

        filtered.clear();
        filtered.extend(
            buffer[..read]
                .iter()
                .copied()
                .filter(|byte| !is_curseforge_stripped(*byte)),
        );
        hasher.update(&filtered);
    }

    Ok(hasher.finish() as u64)
}

async fn curseforge_filtered_length(path: &Path) -> Result<u32, io::Error> {
    let mut file = File::open(path).await?;
    let mut buffer = vec![0u8; FINGERPRINT_READ_BUFFER];
    let mut length: u64 = 0;

    loop {
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            break;
        }

        length += buffer[..read]
            .iter()
            .filter(|byte| !is_curseforge_stripped(**byte))
            .count() as u64;
    }

    u32::try_from(length).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "file is too large for a CurseForge fingerprint",
        )
    })
}
