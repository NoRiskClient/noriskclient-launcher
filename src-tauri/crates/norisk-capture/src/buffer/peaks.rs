
use std::collections::VecDeque;

pub const POINT_MS: i64 = 20;

const SECOND_100NS: i64 = 10_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Peak {
    pub pts: i64,
    pub value: u8,
}

pub struct PeakRing {
    points: VecDeque<Peak>,
    window_ticks: i64,
    time_base_den: i64,
    sample_rate: u32,
    channels: usize,
    open: Option<Open>,
}

#[derive(Debug, Clone, Copy)]
struct Open {
    pts: i64,
    frames: usize,
    peak: f32,
}

impl PeakRing {
    pub fn new(window_seconds: f32, time_base_den: i64, sample_rate: u32, channels: u16) -> Self {
        let window = (window_seconds.max(0.0) as f64 * time_base_den as f64) as i64;
        Self {
            points: VecDeque::new(),
            window_ticks: window.max(1),
            time_base_den,
            sample_rate: sample_rate.max(1),
            channels: channels.max(1) as usize,
            open: None,
        }
    }

    fn frames_per_point(&self) -> usize {
        ((self.sample_rate as i64 * POINT_MS / 1_000).max(1)) as usize
    }

    pub fn push(&mut self, samples: &[f32], timestamp_100ns: i64) {
        if samples.is_empty() {
            return;
        }

        let wanted = self.frames_per_point();
        let total_frames = samples.len() / self.channels;
        let mut offset = 0usize;

        while offset < total_frames {
            let open = match self.open {
                Some(open) => open,
                None => Open {
                    pts: self.ticks(timestamp_100ns, offset),
                    frames: 0,
                    peak: 0.0,
                },
            };

            let take = wanted
                .saturating_sub(open.frames)
                .max(1)
                .min(total_frames - offset);

            let from = offset * self.channels;
            let to = from + take * self.channels;
            let loudest = samples[from..to]
                .iter()
                .fold(0.0f32, |acc, s| acc.max(s.abs()));

            let filled = Open {
                pts: open.pts,
                frames: open.frames + take,
                peak: open.peak.max(loudest),
            };

            if filled.frames >= wanted {
                self.close(filled);
            } else {
                self.open = Some(filled);
            }

            offset += take;
        }
    }

    pub fn flush(&mut self) {
        if let Some(open) = self.open.take() {
            if open.frames > 0 {
                self.close(open);
            }
        }
    }

    fn close(&mut self, open: Open) {
        self.open = None;
        self.points.push_back(Peak {
            pts: open.pts,
            value: quantise(open.peak),
        });
        self.trim();
    }

    fn ticks(&self, timestamp_100ns: i64, frame_offset: usize) -> i64 {
        let within = frame_offset as i64 * SECOND_100NS / self.sample_rate as i64;
        ((timestamp_100ns + within) as i128 * self.time_base_den as i128 / SECOND_100NS as i128)
            as i64
    }

    fn trim(&mut self) {
        let Some(newest) = self.points.back().map(|p| p.pts) else {
            return;
        };
        let keep_from = newest - self.window_ticks - self.time_base_den * 3;
        while self.points.front().is_some_and(|p| p.pts < keep_from) {
            self.points.pop_front();
        }
    }

    pub fn extract(&self, from_pts: i64, to_pts: i64) -> Vec<Peak> {
        if to_pts < from_pts {
            return Vec::new();
        }
        self.points
            .iter()
            .skip_while(|p| p.pts < from_pts)
            .take_while(|p| p.pts <= to_pts)
            .copied()
            .collect()
    }

    pub fn len(&self) -> usize {
        self.points.len()
    }

    pub fn is_empty(&self) -> bool {
        self.points.is_empty()
    }
}

fn quantise(peak: f32) -> u8 {
    (peak.clamp(0.0, 1.0) * 255.0).round() as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    const TB: i64 = 90_000;
    const RATE: u32 = 48_000;

    fn ring() -> PeakRing {
        PeakRing::new(30.0, TB, RATE, 2)
    }

    fn per_point() -> usize {
        (RATE as i64 * POINT_MS / 1_000) as usize
    }

    fn tone(frames: usize, amplitude: f32) -> Vec<f32> {
        vec![amplitude; frames * 2]
    }

    fn at(count: i64) -> i64 {
        count * 10_000
    }

    #[test]
    fn one_point_covers_the_span_it_promises() {
        let mut ring = ring();
        ring.push(&tone(per_point() * 5, 0.5), 0);

        assert_eq!(ring.len(), 5, "five points for five spans of audio");

        let points = ring.extract(i64::MIN, i64::MAX);
        assert_eq!(
            points[1].pts - points[0].pts,
            POINT_MS * TB / 1_000,
            "points should sit {POINT_MS} ms apart on the clip's own clock"
        );
    }

    #[test]
    fn small_blocks_accumulate_into_whole_points() {
        let mut whole = ring();
        let mut dribbled = ring();

        whole.push(&tone(per_point() * 4, 0.5), 0);

        let chunk = per_point() / 4;
        for i in 0..16 {
            let when = i as i64 * chunk as i64 * SECOND_100NS / RATE as i64;
            dribbled.push(&tone(chunk, 0.5), when);
        }

        assert_eq!(
            whole.len(),
            dribbled.len(),
            "the block size the driver picks must not change the resolution"
        );
        assert_eq!(
            whole.extract(i64::MIN, i64::MAX),
            dribbled.extract(i64::MIN, i64::MAX)
        );
    }

    #[test]
    fn the_loudest_sample_in_a_span_is_what_survives() {
        let mut ring = ring();

        let mut block = tone(per_point(), 0.1);
        block[per_point()] = 0.9; // one spike, mid span
        ring.push(&block, 0);

        assert_eq!(
            ring.extract(i64::MIN, i64::MAX)[0].value,
            quantise(0.9),
            "a waveform that averages a spike away hides the moment worth cutting to"
        );
    }

    #[test]
    fn a_negative_swing_counts_as_loud_as_a_positive_one() {
        let mut ring = ring();
        ring.push(&tone(per_point(), -0.7), 0);
        assert_eq!(ring.extract(i64::MIN, i64::MAX)[0].value, quantise(0.7));
    }

    #[test]
    fn silence_reads_as_zero_and_full_scale_as_the_top() {
        let mut ring = ring();
        ring.push(&tone(per_point(), 0.0), 0);
        ring.push(&tone(per_point(), 1.0), at(POINT_MS));

        let points = ring.extract(i64::MIN, i64::MAX);
        assert_eq!(points[0].value, 0);
        assert_eq!(points[1].value, 255);
    }

    #[test]
    fn anything_past_full_scale_is_held_at_the_top() {
        assert_eq!(quantise(4.0), 255);
        assert_eq!(quantise(-4.0), 0);
    }

    #[test]
    fn the_window_bounds_what_is_kept() {
        let mut ring = PeakRing::new(10.0, TB, RATE, 2);
        for i in 0..(60 * 1_000 / POINT_MS) {
            ring.push(&tone(per_point(), 0.5), at(i * POINT_MS));
        }

        let points = ring.extract(i64::MIN, i64::MAX);
        let held = (points.last().unwrap().pts - points[0].pts) as f64 / TB as f64;
        assert!(held >= 10.0, "must hold the window, held {held:.1}s");
        assert!(held <= 14.0, "grew past window plus slack: {held:.1}s");
    }

    #[test]
    fn a_window_of_peaks_is_small_enough_to_ship_in_a_sidecar() {
        let mut ring = ring();
        for i in 0..(120 * 1_000 / POINT_MS) {
            ring.push(&tone(per_point(), 0.5), at(i * POINT_MS));
        }

        assert!(
            ring.len() < 4_000,
            "a 30 s envelope should be a couple of kilobytes, got {}",
            ring.len()
        );
    }

    #[test]
    fn extraction_keeps_to_the_range_it_was_given() {
        let mut ring = ring();
        for i in 0..500 {
            ring.push(&tone(per_point(), 0.5), at(i * POINT_MS));
        }

        let from = 2 * TB;
        let to = 5 * TB;
        let points = ring.extract(from, to);

        assert!(!points.is_empty());
        assert!(points.first().unwrap().pts >= from);
        assert!(points.last().unwrap().pts <= to);
    }

    #[test]
    fn an_inverted_range_extracts_nothing() {
        let mut ring = ring();
        ring.push(&tone(48_000, 0.5), 0);
        assert!(ring.extract(5 * TB, TB).is_empty());
    }

    #[test]
    fn flushing_releases_the_half_collected_tail() {
        let mut ring = ring();

        ring.push(&tone(per_point() / 3, 0.6), 0);
        assert_eq!(ring.len(), 0, "a partial span is not a point yet");

        ring.flush();
        assert_eq!(ring.len(), 1, "the tail of a clip still has to be drawn");
        assert_eq!(ring.extract(i64::MIN, i64::MAX)[0].value, quantise(0.6));
    }

    #[test]
    fn flushing_an_empty_ring_is_harmless() {
        let mut ring = ring();
        ring.flush();
        ring.flush();
        assert!(ring.is_empty());
    }

    #[test]
    fn an_empty_block_changes_nothing() {
        let mut ring = ring();
        ring.push(&[], 0);
        assert!(ring.is_empty());
    }

    #[test]
    fn mono_audio_is_measured_the_same_as_stereo() {
        let mut mono = PeakRing::new(30.0, TB, RATE, 1);
        mono.push(&vec![0.42f32; per_point()], 0);
        assert_eq!(mono.extract(i64::MIN, i64::MAX)[0].value, quantise(0.42));
    }
}
