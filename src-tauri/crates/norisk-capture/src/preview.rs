
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

fn preview_dir() -> PathBuf {
    std::env::temp_dir().join("nrc-clip-preview")
}

pub fn prepare(source: &Path) -> Result<Vec<norisk_ipc::PreviewTrack>> {
    let clip = crate::trim::read(source)?;

    let dir = preview_dir();
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("could not create {}", dir.display()))?;

    let stem = source
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "clip".into());

    let mut out = Vec::new();
    for (index, track) in clip.audio.iter().enumerate() {
        let samples = crate::audio::decoder::decode_all(
            track.format.sample_rate,
            track.format.channels,
            &track.format.extradata,
            &track.packets,
        )
        .with_context(|| format!("could not decode audio track {index}"))?;

        let path = dir.join(format!("{stem}-{index}.wav"));
        write_wav(
            &path,
            &samples,
            crate::audio::encoder::OUTPUT_SAMPLE_RATE as u32,
            crate::audio::encoder::OUTPUT_CHANNELS as u16,
        )
        .with_context(|| format!("could not write {}", path.display()))?;

        out.push(norisk_ipc::PreviewTrack {
            stream: index as u32,
            label: track.format.label.clone(),
            path,
        });
    }

    log::info!(
        "Prepared {} audio track(s) for the cutter's preview",
        out.len()
    );
    Ok(out)
}

fn write_wav(path: &Path, samples: &[f32], sample_rate: u32, channels: u16) -> Result<()> {
    let bytes_per_sample = 2u32;
    let data_len = samples.len() as u32 * bytes_per_sample;
    let byte_rate = sample_rate * channels as u32 * bytes_per_sample;
    let block_align = channels * bytes_per_sample as u16;

    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // PCM header length
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());

    for sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let value = if clamped < 0.0 {
            (clamped * 32_768.0) as i16
        } else {
            (clamped * 32_767.0) as i16
        };
        out.extend_from_slice(&value.to_le_bytes());
    }

    std::fs::write(path, out)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_header(bytes: &[u8]) -> (u16, u32, u16, u32) {
        let channels = u16::from_le_bytes([bytes[22], bytes[23]]);
        let rate = u32::from_le_bytes([bytes[24], bytes[25], bytes[26], bytes[27]]);
        let bits = u16::from_le_bytes([bytes[34], bytes[35]]);
        let data = u32::from_le_bytes([bytes[40], bytes[41], bytes[42], bytes[43]]);
        (channels, rate, bits, data)
    }

    fn round_trip(samples: &[f32]) -> Vec<i16> {
        static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let tag = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("nrc-wav-{tag}.wav"));
        write_wav(&path, samples, 48_000, 2).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let _ = std::fs::remove_file(&path);

        bytes[44..]
            .chunks_exact(2)
            .map(|pair| i16::from_le_bytes([pair[0], pair[1]]))
            .collect()
    }

    #[test]
    fn the_header_says_what_the_file_holds() {
        let path = std::env::temp_dir().join("nrc-wav-header.wav");
        write_wav(&path, &[0.0; 8], 48_000, 2).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let _ = std::fs::remove_file(&path);

        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(parse_header(&bytes), (2, 48_000, 16, 16));
        assert_eq!(bytes.len(), 44 + 16);
    }

    #[test]
    fn silence_stays_silent() {
        assert!(round_trip(&[0.0; 16]).iter().all(|s| *s == 0));
    }

    #[test]
    fn the_loudest_sample_does_not_wrap_around() {
        let out = round_trip(&[1.0, -1.0]);
        assert_eq!(out[0], 32_767);
        assert_eq!(out[1], -32_768);
    }

    #[test]
    fn anything_past_full_scale_is_clamped_rather_than_wrapped() {
        let out = round_trip(&[2.5, -2.5]);
        assert_eq!(out[0], 32_767);
        assert_eq!(out[1], -32_768);
    }

    #[test]
    fn ordinary_samples_keep_their_level() {
        let out = round_trip(&[0.5, -0.5]);
        assert!((out[0] as f32 / 32_767.0 - 0.5).abs() < 0.001);
        assert!((out[1] as f32 / 32_768.0 + 0.5).abs() < 0.001);
    }
}
