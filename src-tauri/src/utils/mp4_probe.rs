use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

const MAX_DEPTH: u8 = 8;

#[derive(Debug, Default, PartialEq)]
pub struct Mp4Codecs {
    pub video: Vec<String>,
    pub audio: Vec<String>,
}

impl Mp4Codecs {
    pub fn shareable(&self) -> bool {
        !self.video.is_empty()
            && self.video.iter().all(|c| c == "avc1" || c == "avc3")
            && self.audio.iter().all(|c| c == "mp4a")
    }
}

pub fn codecs(path: &Path) -> std::io::Result<Mp4Codecs> {
    let mut file = std::fs::File::open(path)?;
    let len = file.metadata()?.len();
    codecs_in(&mut file, len)
}

pub fn codecs_in<R: Read + Seek>(reader: &mut R, len: u64) -> std::io::Result<Mp4Codecs> {
    let mut found = Mp4Codecs::default();
    walk(reader, 0, len, 0, &mut None, &mut found)?;
    Ok(found)
}

fn walk<R: Read + Seek>(
    file: &mut R,
    start: u64,
    end: u64,
    depth: u8,
    handler: &mut Option<[u8; 4]>,
    found: &mut Mp4Codecs,
) -> std::io::Result<()> {
    if depth > MAX_DEPTH {
        return Ok(());
    }
    let mut at = start;
    while at + 8 <= end {
        file.seek(SeekFrom::Start(at))?;
        let mut header = [0u8; 8];
        file.read_exact(&mut header)?;
        let kind: [u8; 4] = [header[4], header[5], header[6], header[7]];
        let mut body = at + 8;
        let size = match u32::from_be_bytes([header[0], header[1], header[2], header[3]]) {
            0 => end - at,
            1 => {
                let mut large = [0u8; 8];
                file.read_exact(&mut large)?;
                body += 8;
                u64::from_be_bytes(large)
            }
            size => u64::from(size),
        };
        if size < body - at || size > end - at {
            break;
        }
        let next = at + size;

        match &kind {
            b"moov" | b"mdia" | b"minf" | b"stbl" => walk(file, body, next, depth + 1, handler, found)?,
            b"trak" => walk(file, body, next, depth + 1, &mut None, found)?,
            b"hdlr" if handler.is_none() => *handler = read_at(file, body + 8, next)?,
            b"stsd" => {
                if let Some(entry) = read_at(file, body + 12, next)? {
                    let codec = String::from_utf8_lossy(&entry).into_owned();
                    match handler {
                        Some(h) if h == b"vide" => found.video.push(codec),
                        Some(h) if h == b"soun" => found.audio.push(codec),
                        _ => {}
                    }
                }
            }
            _ => {}
        }
        at = next;
    }
    Ok(())
}

fn read_at<R: Read + Seek>(file: &mut R, at: u64, end: u64) -> std::io::Result<Option<[u8; 4]>> {
    if at + 4 > end {
        return Ok(None);
    }
    file.seek(SeekFrom::Start(at))?;
    let mut value = [0u8; 4];
    file.read_exact(&mut value)?;
    Ok(Some(value))
}
