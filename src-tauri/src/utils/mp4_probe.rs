//! Which codecs an MP4's tracks use, read from their sample descriptions without decoding.

use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

#[derive(Debug, Default, PartialEq)]
pub struct Mp4Codecs {
    pub video: Vec<String>,
    pub audio: Vec<String>,
}

impl Mp4Codecs {
    /// H.264 video and AAC audio, which the share check takes as it is.
    pub fn shareable(&self) -> bool {
        !self.video.is_empty()
            && self.video.iter().all(|c| c == "avc1" || c == "avc3")
            && self.audio.iter().all(|c| c == "mp4a")
    }
}

pub fn codecs(path: &Path) -> std::io::Result<Mp4Codecs> {
    let mut file = std::fs::File::open(path)?;
    let end = file.metadata()?.len();
    let mut found = Mp4Codecs::default();
    walk(&mut file, 0, end, &mut None, &mut found)?;
    Ok(found)
}

fn walk<R: Read + Seek>(
    file: &mut R,
    start: u64,
    end: u64,
    handler: &mut Option<[u8; 4]>,
    found: &mut Mp4Codecs,
) -> std::io::Result<()> {
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
            b"moov" | b"mdia" | b"minf" | b"stbl" => walk(file, body, next, handler, found)?,
            b"trak" => walk(file, body, next, &mut None, found)?,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn boxed(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut out = ((body.len() + 8) as u32).to_be_bytes().to_vec();
        out.extend_from_slice(kind);
        out.extend_from_slice(body);
        out
    }

    fn track(handler: &[u8; 4], codec: &[u8; 4]) -> Vec<u8> {
        let hdlr = boxed(b"hdlr", &[&[0u8; 8][..], handler, &[0u8; 12]].concat());
        let entry = boxed(codec, &[0u8; 8]);
        let stsd = boxed(b"stsd", &[&[0, 0, 0, 0, 0, 0, 0, 1][..], &entry].concat());
        let data_handler = boxed(b"hdlr", &[&[0u8; 8][..], b"alis", &[0u8; 12]].concat());
        let minf = boxed(b"minf", &[data_handler, boxed(b"stbl", &stsd)].concat());
        boxed(b"trak", &boxed(b"mdia", &[hdlr, minf].concat()))
    }

    fn probe(file: Vec<u8>) -> Mp4Codecs {
        let mut found = Mp4Codecs::default();
        let len = file.len() as u64;
        walk(&mut std::io::Cursor::new(file), 0, len, &mut None, &mut found).unwrap();
        found
    }

    fn clip(tracks: &[(&[u8; 4], &[u8; 4])], index_first: bool) -> Vec<u8> {
        let moov = boxed(
            b"moov",
            &tracks.iter().flat_map(|(h, c)| track(h, c)).collect::<Vec<u8>>(),
        );
        let mdat = boxed(b"mdat", &[7u8; 64]);
        let ftyp = boxed(b"ftyp", b"isomiso2");
        if index_first {
            [ftyp, moov, mdat].concat()
        } else {
            [ftyp, mdat, moov].concat()
        }
    }

    #[test]
    fn a_launcher_clip_reads_as_h264_with_its_aac_tracks_wherever_the_index_is() {
        for index_first in [true, false] {
            let found = probe(clip(&[(b"vide", b"avc1"), (b"soun", b"mp4a"), (b"soun", b"mp4a")], index_first));
            assert_eq!(found.video, vec!["avc1"]);
            assert_eq!(found.audio, vec!["mp4a", "mp4a"]);
            assert!(found.shareable());
        }
    }

    #[test]
    fn hevc_av1_or_other_audio_need_converting() {
        for (video, audio) in [(b"hvc1", b"mp4a"), (b"hev1", b"mp4a"), (b"av01", b"mp4a"), (b"avc1", b"Opus")] {
            assert!(!probe(clip(&[(b"vide", video), (b"soun", audio)], false)).shareable());
        }
        assert!(!probe(clip(&[(b"soun", b"mp4a")], true)).shareable(), "no picture at all");
    }

    #[test]
    fn a_cut_off_file_stops_quietly() {
        let mut file = clip(&[(b"vide", b"avc1")], true);
        file.truncate(30);
        assert_eq!(probe(file), Mp4Codecs::default());
    }
}
