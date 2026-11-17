use noriskclient_launcher_v3_lib::utils::mp4_probe::{codecs_in, Mp4Codecs};

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
    let len = file.len() as u64;
    codecs_in(&mut std::io::Cursor::new(file), len).unwrap()
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

#[test]
fn a_file_of_endlessly_nested_boxes_is_read_without_overflowing() {
    let mut file = boxed(b"mdat", &[]);
    for _ in 0..100_000 {
        file = boxed(b"moov", &file);
    }
    assert_eq!(probe(file), Mp4Codecs::default());
}
