use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Track {
    Game = 0,
    Other = 1,
    Microphone = 2,
}

const TRACKS: usize = 3;

const HOLD_100NS: i64 = 2_000_000;

pub fn apply_gain(samples: &[f32], gain: f32, out: &mut Vec<f32>) {
    out.clear();
    out.reserve(samples.len());
    out.extend(samples.iter().map(|s| (s * gain).clamp(-1.0, 1.0)));
}

#[derive(Debug, Clone, PartialEq)]
pub struct MixedBlock {
    pub samples: Vec<f32>,
    pub timestamp_100ns: i64,
}

#[derive(Clone)]
pub struct Mixer {
    inner: Arc<Mutex<State>>,
}

struct State {
    sample_rate: u32,
    channels: usize,
    base: Option<i64>,
    buffer: Vec<f32>,
    filled: [usize; TRACKS],
    expected: [bool; TRACKS],
}

impl Mixer {
    pub fn new(sample_rate: u32, channels: u16, tracks: &[Track]) -> Self {
        let mut expected = [false; TRACKS];
        for track in tracks {
            expected[*track as usize] = true;
        }

        Self {
            inner: Arc::new(Mutex::new(State {
                sample_rate: sample_rate.max(1),
                channels: channels.max(1) as usize,
                base: None,
                buffer: Vec::new(),
                filled: [0; TRACKS],
                expected,
            })),
        }
    }

    pub fn push(
        &self,
        track: Track,
        samples: &[f32],
        timestamp_100ns: i64,
        gain: f32,
    ) -> Vec<MixedBlock> {
        let mut state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        state.write(track, samples, timestamp_100ns, gain);
        state.take_complete()
    }

    pub fn span_100ns(&self, samples: usize) -> i64 {
        let state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        (samples / state.channels) as i64 * 10_000_000 / state.sample_rate as i64
    }

    pub fn flush(&self) -> Vec<MixedBlock> {
        let mut state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        state.take_all()
    }
}

impl State {
    fn frames_per_100ns(&self, span: i64) -> i64 {
        span.saturating_mul(self.sample_rate as i64) / 10_000_000
    }

    fn write(&mut self, track: Track, samples: &[f32], timestamp_100ns: i64, gain: f32) {
        if samples.is_empty() {
            return;
        }

        let base = *self.base.get_or_insert(timestamp_100ns);
        let offset = self.frames_per_100ns(timestamp_100ns - base);
        let (offset, samples) = if offset < 0 {
            let late = (-offset) as usize * self.channels;
            if late >= samples.len() {
                log::debug!("Discarding {track:?} audio from before the mix window");
                return;
            }
            (0, &samples[late..])
        } else {
            (offset, samples)
        };

        let start = offset as usize * self.channels;
        let end = start + samples.len();
        if self.buffer.len() < end {
            self.buffer.resize(end, 0.0);
        }

        for (slot, sample) in self.buffer[start..end].iter_mut().zip(samples) {
            *slot += sample * gain;
        }

        let index = track as usize;
        self.filled[index] = self.filled[index].max(end / self.channels);
    }

    fn complete_frames(&self) -> usize {
        let settled = self
            .expected
            .iter()
            .enumerate()
            .filter(|(_, expected)| **expected)
            .map(|(index, _)| self.filled[index])
            .min()
            .unwrap_or(0);

        let hold = self.frames_per_100ns(HOLD_100NS).max(0) as usize;
        settled.saturating_sub(hold)
    }

    fn take_complete(&mut self) -> Vec<MixedBlock> {
        let frames = self.complete_frames();
        if frames == 0 {
            return Vec::new();
        }
        self.take(frames)
    }

    fn take_all(&mut self) -> Vec<MixedBlock> {
        let frames = self.buffer.len() / self.channels;
        if frames == 0 {
            return Vec::new();
        }
        self.take(frames)
    }

    fn take(&mut self, frames: usize) -> Vec<MixedBlock> {
        let Some(base) = self.base else {
            return Vec::new();
        };

        let count = (frames * self.channels).min(self.buffer.len());
        let mut samples: Vec<f32> = self.buffer.drain(..count).collect();
        for sample in &mut samples {
            *sample = sample.clamp(-1.0, 1.0);
        }

        let taken = count / self.channels;
        self.base = Some(base + taken as i64 * 10_000_000 / self.sample_rate as i64);
        for filled in &mut self.filled {
            *filled = filled.saturating_sub(taken);
        }

        vec![MixedBlock {
            samples,
            timestamp_100ns: base,
        }]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 48_000;
    const CHANNELS: u16 = 2;

    fn ticks(frames: i64) -> i64 {
        frames * 10_000_000 / RATE as i64
    }

    fn frames(count: usize, value: f32) -> Vec<f32> {
        vec![value; count * CHANNELS as usize]
    }

    #[test]
    fn nothing_is_emitted_until_both_tracks_have_contributed() {
        let mixer = Mixer::new(RATE, CHANNELS, &[Track::Game, Track::Other]);

        let out = mixer.push(Track::Game, &frames(RATE as usize, 0.5), 0, 1.0);
        assert!(out.is_empty(), "one track alone must not produce output");

        let out = mixer.push(Track::Other, &frames(RATE as usize, 0.25), 0, 1.0);
        assert!(!out.is_empty(), "both tracks present should release audio");
    }

    #[test]
    fn overlapping_samples_are_summed() {
        let mixer = Mixer::new(RATE, CHANNELS, &[Track::Game, Track::Other]);
        let count = RATE as usize;

        mixer.push(Track::Game, &frames(count, 0.5), 0, 1.0);
        let blocks = mixer.push(Track::Other, &frames(count, 0.25), 0, 1.0);

        let mixed = &blocks[0].samples;
        assert!(!mixed.is_empty());
        for sample in mixed {
            assert!((sample - 0.75).abs() < 1e-6, "expected 0.75, got {sample}");
        }
    }

    #[test]
    fn each_track_is_scaled_by_its_own_gain() {
        let mixer = Mixer::new(RATE, CHANNELS, &[Track::Game, Track::Other]);
        let count = RATE as usize;

        mixer.push(Track::Game, &frames(count, 1.0), 0, 0.5);
        let blocks = mixer.push(Track::Other, &frames(count, 1.0), 0, 0.25);

        for sample in &blocks[0].samples {
            assert!((sample - 0.75).abs() < 1e-6, "expected 0.75, got {sample}");
        }
    }

    #[test]
    fn a_muted_track_contributes_nothing() {
        let mixer = Mixer::new(RATE, CHANNELS, &[Track::Game, Track::Other]);
        let count = RATE as usize;

        mixer.push(Track::Game, &frames(count, 0.8), 0, 1.0);
        let blocks = mixer.push(Track::Other, &frames(count, 1.0), 0, 0.0);

        for sample in &blocks[0].samples {
            assert!((sample - 0.8).abs() < 1e-6, "expected 0.8, got {sample}");
        }
    }

    #[test]
    fn late_arrivals_land_at_their_captured_position() {
        let mixer = Mixer::new(RATE, CHANNELS, &[Track::Game, Track::Other]);
        let block = 4_800;

        mixer.push(Track::Game, &frames(block * 2, 0.5), 0, 1.0);
        mixer.push(Track::Other, &frames(block, 0.25), ticks(block as i64), 1.0);
        mixer.push(Track::Other, &frames(block, 0.125), 0, 1.0);

        let blocks = mixer.flush();
        let mixed = &blocks[0].samples;

        let first = mixed[0];
        let second = mixed[block * CHANNELS as usize];
        assert!((first - 0.625).abs() < 1e-6, "first block is {first}");
        assert!((second - 0.75).abs() < 1e-6, "second block is {second}");
    }

    #[test]
    fn a_gap_in_one_track_does_not_move_the_other() {
        let mixer = Mixer::new(RATE, CHANNELS, &[Track::Game, Track::Other]);
        let block = 4_800;

        mixer.push(Track::Game, &frames(block, 1.0), 0, 1.0);
        mixer.push(Track::Other, &frames(block, 1.0), ticks(block as i64), 1.0);

        let blocks = mixer.flush();
        let mixed = &blocks[0].samples;

        assert!((mixed[0] - 1.0).abs() < 1e-6);
        assert!((mixed[block * CHANNELS as usize] - 1.0).abs() < 1e-6);
        assert_eq!(mixed.len(), block * 2 * CHANNELS as usize);
    }

    #[test]
    fn a_loud_mix_is_clamped_rather_than_wrapped() {
        let mixer = Mixer::new(RATE, CHANNELS, &[Track::Game, Track::Other]);
        let count = RATE as usize;

        mixer.push(Track::Game, &frames(count, 0.9), 0, 1.0);
        let blocks = mixer.push(Track::Other, &frames(count, 0.9), 0, 1.0);

        for sample in &blocks[0].samples {
            assert!(*sample <= 1.0, "sample {sample} exceeds full scale");
            assert!((sample - 1.0).abs() < 1e-6);
        }
    }

    #[test]
    fn emitted_timestamps_follow_the_samples() {
        let mixer = Mixer::new(RATE, CHANNELS, &[Track::Game, Track::Other]);
        let count = RATE as usize;

        mixer.push(Track::Game, &frames(count, 0.5), 0, 1.0);
        let first = mixer.push(Track::Other, &frames(count, 0.5), 0, 1.0);
        assert_eq!(first[0].timestamp_100ns, 0);

        let emitted = first[0].samples.len() / CHANNELS as usize;
        let expected = ticks(emitted as i64);

        mixer.push(Track::Game, &frames(count, 0.5), ticks(count as i64), 1.0);
        let second = mixer.push(Track::Other, &frames(count, 0.5), ticks(count as i64), 1.0);
        assert_eq!(second[0].timestamp_100ns, expected);
    }

    #[test]
    fn a_track_that_was_not_asked_for_never_blocks() {
        let mixer = Mixer::new(RATE, CHANNELS, &[Track::Game]);

        let out = mixer.push(Track::Game, &frames(RATE as usize, 0.5), 0, 1.0);
        assert!(!out.is_empty(), "the only expected track should release audio");
    }

    #[test]
    fn three_tracks_are_summed_together() {
        let mixer = Mixer::new(
            RATE,
            CHANNELS,
            &[Track::Game, Track::Other, Track::Microphone],
        );
        let count = RATE as usize;

        mixer.push(Track::Game, &frames(count, 0.4), 0, 1.0);
        mixer.push(Track::Other, &frames(count, 0.2), 0, 1.0);
        let blocks = mixer.push(Track::Microphone, &frames(count, 0.1), 0, 1.0);

        assert!(!blocks.is_empty(), "all three present should release audio");
        for sample in &blocks[0].samples {
            assert!((sample - 0.7).abs() < 1e-6, "expected 0.7, got {sample}");
        }
    }

    #[test]
    fn every_expected_track_has_to_arrive() {
        let mixer = Mixer::new(
            RATE,
            CHANNELS,
            &[Track::Game, Track::Other, Track::Microphone],
        );
        let count = RATE as usize;

        mixer.push(Track::Game, &frames(count, 0.4), 0, 1.0);
        let out = mixer.push(Track::Other, &frames(count, 0.2), 0, 1.0);
        assert!(out.is_empty(), "two of three tracks must not be enough");
    }

    #[test]
    fn a_silent_microphone_still_lets_audio_through() {
        let mixer = Mixer::new(RATE, CHANNELS, &[Track::Game, Track::Microphone]);
        let count = RATE as usize;

        mixer.push(Track::Game, &frames(count, 0.5), 0, 1.0);
        let blocks = mixer.push(Track::Microphone, &frames(count, 0.0), 0, 1.0);

        assert!(!blocks.is_empty());
        for sample in &blocks[0].samples {
            assert!((sample - 0.5).abs() < 1e-6);
        }
    }

    #[test]
    fn flushing_an_empty_mixer_is_harmless() {
        let mixer = Mixer::new(RATE, CHANNELS, &[Track::Game, Track::Other]);
        assert!(mixer.flush().is_empty());
    }

    #[test]
    fn the_hold_window_is_released_by_flushing() {
        let mixer = Mixer::new(RATE, CHANNELS, &[Track::Game, Track::Other]);
        let count = RATE as usize; // one second

        mixer.push(Track::Game, &frames(count, 0.5), 0, 1.0);
        let live = mixer.push(Track::Other, &frames(count, 0.5), 0, 1.0);

        let emitted: usize = live.iter().map(|b| b.samples.len()).sum();
        let held = count * CHANNELS as usize - emitted;
        let hold_frames = (HOLD_100NS * RATE as i64 / 10_000_000) as usize;
        assert_eq!(
            held,
            hold_frames * CHANNELS as usize,
            "exactly the hold window should still be held back"
        );

        let tail = mixer.flush();
        assert_eq!(
            tail.iter().map(|b| b.samples.len()).sum::<usize>(),
            held,
            "flushing must hand over everything that was held"
        );
        assert!(mixer.flush().is_empty(), "and leave nothing behind");
    }

    #[test]
    fn the_flushed_tail_continues_where_the_live_blocks_stopped() {
        let mixer = Mixer::new(RATE, CHANNELS, &[Track::Game, Track::Other]);
        let count = RATE as usize;

        mixer.push(Track::Game, &frames(count, 0.5), 0, 1.0);
        let live = mixer.push(Track::Other, &frames(count, 0.5), 0, 1.0);

        let last = live.last().expect("a full second should release audio");
        let after = last.timestamp_100ns + ticks((last.samples.len() / CHANNELS as usize) as i64);

        let tail = mixer.flush();
        assert_eq!(tail[0].timestamp_100ns, after);
    }

    #[test]
    fn a_block_straddling_the_new_window_keeps_its_placeable_part() {
        let mixer = Mixer::new(RATE, CHANNELS, &[Track::Game, Track::Other]);
        let block = 4_800;

        mixer.push(Track::Game, &frames(block * 2, 0.5), 0, 1.0);
        mixer.push(Track::Other, &frames(block * 2, 0.25), 0, 1.0);
        mixer.flush();

        mixer.push(Track::Game, &frames(block * 2, 0.5), ticks(block as i64 * 2), 1.0);
        mixer.push(Track::Other, &frames(block * 2, 0.25), ticks(block as i64), 1.0);

        let blocks = mixer.flush();
        let mixed = &blocks[0].samples;

        assert!(
            (mixed[0] - 0.75).abs() < 1e-6,
            "expected the straddling block's tail to be mixed in, got {}",
            mixed[0]
        );
    }

    #[test]
    fn a_block_wholly_before_the_window_is_still_dropped() {
        let mixer = Mixer::new(RATE, CHANNELS, &[Track::Game, Track::Other]);
        let block = 4_800;

        mixer.push(Track::Game, &frames(block * 4, 0.5), 0, 1.0);
        mixer.push(Track::Other, &frames(block * 4, 0.25), 0, 1.0);
        mixer.flush();

        mixer.push(Track::Other, &frames(block, 1.0), 0, 1.0);
        assert!(
            mixer.flush().is_empty(),
            "a block from before the window must not resurface"
        );
    }

    #[test]
    fn a_single_source_is_scaled_by_its_level() {
        let mut out = Vec::new();

        apply_gain(&[1.0, -1.0, 0.5], 0.5, &mut out);
        assert_eq!(out, vec![0.5, -0.5, 0.25]);

        apply_gain(&[1.0, -1.0], 0.0, &mut out);
        assert_eq!(out, vec![0.0, 0.0]);
    }

    #[test]
    fn a_boosted_single_source_is_clamped_too() {
        let mut out = Vec::new();
        apply_gain(&[0.8, -0.8], 2.0, &mut out);
        assert_eq!(out, vec![1.0, -1.0]);
    }

    #[test]
    fn the_output_buffer_is_reused() {
        let mut out = Vec::with_capacity(1024);
        let before = out.capacity();

        for _ in 0..100 {
            apply_gain(&[0.1; 512], 1.0, &mut out);
        }

        assert_eq!(out.len(), 512);
        assert_eq!(out.capacity(), before, "the buffer should not have grown");
    }
}
