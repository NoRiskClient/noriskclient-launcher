pub mod audio;
pub mod peaks;

pub use audio::AudioRing;
pub use peaks::{Peak, PeakRing};

use std::collections::VecDeque;
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Packet {
    pub data: Arc<[u8]>,
    pub pts: i64,
    pub dts: i64,
    pub keyframe: bool,
}

impl Packet {
    pub fn len(&self) -> usize {
        self.data.len()
    }

    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }
}

#[derive(Debug, Clone, Default)]
pub struct Segment {
    pub packets: Vec<Packet>,
    pub start_pts: i64,
    pub end_pts: i64,
    pub bytes: u64,
}

impl Segment {
    fn new(first: Packet) -> Self {
        let bytes = first.len() as u64;
        Self {
            start_pts: first.pts,
            end_pts: first.pts,
            packets: vec![first],
            bytes,
        }
    }

    fn push(&mut self, packet: Packet) {
        self.end_pts = self.end_pts.max(packet.pts);
        self.bytes += packet.len() as u64;
        self.packets.push(packet);
    }

    pub fn is_empty(&self) -> bool {
        self.packets.is_empty()
    }
}

#[derive(Debug, Clone)]
pub struct Clip {
    pub packets: Vec<Packet>,
    pub start_pts: i64,
    pub end_pts: i64,
    pub bytes: u64,
    pub playback_start_pts: i64,
}

impl Clip {
    pub fn duration_seconds(&self, time_base_den: i64) -> f64 {
        if time_base_den == 0 {
            return 0.0;
        }
        (self.end_pts - self.playback_start_pts) as f64 / time_base_den as f64
    }

    pub fn stored_seconds(&self, time_base_den: i64) -> f64 {
        if time_base_den == 0 {
            return 0.0;
        }
        (self.end_pts - self.start_pts) as f64 / time_base_den as f64
    }
}

pub struct RingBuffer {
    closed: VecDeque<Segment>,
    open: Option<Segment>,
    window_ticks: i64,
    time_base_den: i64,
    dropped_before_first_keyframe: u64,
}

impl RingBuffer {
    pub fn new(window_seconds: f32, time_base_den: i64) -> Self {
        let window = (window_seconds.max(0.0) as f64 * time_base_den as f64) as i64;
        Self {
            closed: VecDeque::new(),
            open: None,
            window_ticks: window.max(1),
            time_base_den,
            dropped_before_first_keyframe: 0,
        }
    }

    pub fn push(&mut self, packet: Packet) {
        if packet.keyframe {
            if let Some(finished) = self.open.take() {
                self.closed.push_back(finished);
            }
            self.open = Some(Segment::new(packet));
            self.trim();
            return;
        }

        match self.open.as_mut() {
            Some(segment) => segment.push(packet),
            None => {
                self.dropped_before_first_keyframe += 1;
                return;
            }
        }

        self.trim();
    }

    fn trim(&mut self) {
        while self.closed.len() > 1 {
            let newest_end = self.newest_pts();
            let after_removal = match self.closed.get(1) {
                Some(next) => newest_end - next.start_pts,
                None => break,
            };
            if after_removal >= self.window_ticks {
                self.closed.pop_front();
            } else {
                break;
            }
        }
    }

    pub fn newest_pts(&self) -> i64 {
        self.open
            .as_ref()
            .map(|s| s.end_pts)
            .or_else(|| self.closed.back().map(|s| s.end_pts))
            .unwrap_or(0)
    }

    pub fn oldest_pts(&self) -> i64 {
        self.closed
            .front()
            .or(self.open.as_ref())
            .map(|s| s.start_pts)
            .unwrap_or(0)
    }

    pub fn duration_seconds(&self) -> f64 {
        if self.is_empty() {
            return 0.0;
        }
        (self.newest_pts() - self.oldest_pts()) as f64 / self.time_base_den as f64
    }

    pub fn bytes(&self) -> u64 {
        self.closed.iter().map(|s| s.bytes).sum::<u64>()
            + self.open.as_ref().map_or(0, |s| s.bytes)
    }

    pub fn segment_count(&self) -> usize {
        self.closed.len() + usize::from(self.open.is_some())
    }

    pub fn is_empty(&self) -> bool {
        self.closed.is_empty() && self.open.is_none()
    }

    pub fn dropped_before_first_keyframe(&self) -> u64 {
        self.dropped_before_first_keyframe
    }

    pub fn extract(&self, from_pts: i64, to_pts: i64) -> Option<Clip> {
        if to_pts < from_pts || self.is_empty() {
            return None;
        }

        let segments = self
            .closed
            .iter()
            .chain(self.open.iter())
            .collect::<Vec<_>>();

        let first = segments
            .iter()
            .rposition(|s| s.start_pts <= from_pts)
            .unwrap_or(0);

        let mut packets = Vec::new();
        let mut bytes = 0u64;

        for segment in &segments[first..] {
            if segment.start_pts > to_pts {
                break;
            }
            for packet in &segment.packets {
                if packet.pts > to_pts {
                    break;
                }
                bytes += packet.len() as u64;
                packets.push(packet.clone());
            }
        }

        if packets.is_empty() {
            return None;
        }

        let start_pts = packets[0].pts;

        Some(Clip {
            start_pts,
            end_pts: packets.last().map_or(0, |p| p.pts),
            bytes,
            playback_start_pts: from_pts.max(start_pts),
            packets,
        })
    }

    pub fn extract_around(&self, event_pts: i64, pre: f32, post: f32) -> Option<Clip> {
        let pre_ticks = (pre.max(0.0) as f64 * self.time_base_den as f64) as i64;
        let post_ticks = (post.max(0.0) as f64 * self.time_base_den as f64) as i64;
        self.extract(event_pts - pre_ticks, event_pts + post_ticks)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_clip_plays_for_exactly_as_long_as_asked() {
        let mut buffer = RingBuffer::new(60.0, TB);
        fill(&mut buffer, 60 * 40, FPS * 2, 100);

        let newest = buffer.newest_pts();
        for seconds in [5.0f32, 10.0, 30.0] {
            let clip = buffer
                .extract_around(newest, seconds, 0.0)
                .expect("buffer holds enough");

            let played = clip.duration_seconds(TB);
            assert!(
                (played - seconds as f64).abs() < 0.05,
                "asked for {seconds}s, plays for {played:.2}s"
            );

            assert!(
                clip.stored_seconds(TB) >= played,
                "a clip cannot store less than it plays"
            );
            assert!(
                clip.packets[0].keyframe,
                "playback may start late, but the data must start on a keyframe"
            );
        }
    }

    #[test]
    fn asking_for_more_than_the_buffer_holds_does_not_overstate_it() {
        let mut buffer = RingBuffer::new(60.0, TB);
        fill(&mut buffer, 60 * 5, FPS * 2, 100);

        let clip = buffer
            .extract_around(buffer.newest_pts(), 30.0, 0.0)
            .expect("something is buffered");

        assert_eq!(
            clip.playback_start_pts, clip.start_pts,
            "with nothing to skip, playback starts where the data does"
        );
        assert!(clip.duration_seconds(TB) <= 5.1);
    }

    const TB: i64 = 90_000;
    const FPS: i64 = 60;
    const TICKS_PER_FRAME: i64 = TB / FPS;

    fn fill(buffer: &mut RingBuffer, frames: i64, gop: i64, bytes_per_frame: usize) {
        for i in 0..frames {
            let pts = i * TICKS_PER_FRAME;
            buffer.push(Packet {
                data: vec![0u8; bytes_per_frame].into(),
                pts,
                dts: pts,
                keyframe: i % gop == 0,
            });
        }
    }

    #[test]
    fn packets_before_the_first_keyframe_are_discarded() {
        let mut buffer = RingBuffer::new(30.0, TB);
        for i in 0..5 {
            buffer.push(Packet {
                data: vec![0; 10].into(),
                pts: i,
                dts: i,
                keyframe: false,
            });
        }
        assert!(buffer.is_empty(), "undecodable packets must not be kept");
        assert_eq!(buffer.dropped_before_first_keyframe(), 5);
    }

    #[test]
    fn a_keyframe_opens_a_new_segment() {
        let mut buffer = RingBuffer::new(30.0, TB);
        fill(&mut buffer, 240, 120, 100);
        assert_eq!(buffer.segment_count(), 2);
    }

    #[test]
    fn the_window_bounds_what_is_kept() {
        let mut buffer = RingBuffer::new(10.0, TB);
        fill(&mut buffer, 3600, 120, 1000);

        let held = buffer.duration_seconds();
        assert!(
            held >= 10.0,
            "must hold at least the window, held {held:.1}s"
        );
        assert!(
            held <= 13.0,
            "must not grow far past the window, held {held:.1}s"
        );
    }

    #[test]
    fn memory_stays_bounded_over_a_long_run() {
        let mut buffer = RingBuffer::new(30.0, TB);
        fill(&mut buffer, 36_000, 120, 41_000);

        let mb = buffer.bytes() as f64 / 1e6;
        assert!(
            mb < 110.0,
            "30 s at 20 Mbps should be around 75 MB, got {mb:.0} MB"
        );
        assert!(mb > 40.0, "buffer looks under-filled at {mb:.0} MB");
    }

    #[test]
    fn a_clip_always_starts_on_a_keyframe() {
        let mut buffer = RingBuffer::new(30.0, TB);
        fill(&mut buffer, 1200, 120, 500);

        let from = 7 * TB + TICKS_PER_FRAME * 13;
        let clip = buffer.extract(from, from + 3 * TB).expect("clip");

        assert!(clip.packets[0].keyframe, "first packet must be a keyframe");
        assert!(
            clip.start_pts <= from,
            "clip must not start after the requested point"
        );
    }

    #[test]
    fn a_clip_covers_the_requested_span() {
        let mut buffer = RingBuffer::new(30.0, TB);
        fill(&mut buffer, 1800, 120, 500);

        let event = 25 * TB;
        let clip = buffer.extract_around(event, 20.0, 0.0).expect("clip");

        let duration = clip.duration_seconds(TB);
        assert!(
            duration >= 20.0,
            "asked for 20 s of history, got {duration:.1}s"
        );
        assert!(
            duration <= 22.0,
            "start snapped back too far: {duration:.1}s"
        );
    }

    #[test]
    fn asking_for_more_history_than_exists_returns_what_there_is() {
        let mut buffer = RingBuffer::new(30.0, TB);
        fill(&mut buffer, 300, 120, 500);

        let clip = buffer.extract_around(5 * TB, 30.0, 0.0).expect("clip");
        assert!(clip.packets[0].keyframe);
        assert!(clip.duration_seconds(TB) <= 5.1);
    }

    #[test]
    fn an_empty_buffer_yields_no_clip() {
        let buffer = RingBuffer::new(30.0, TB);
        assert!(buffer.extract(0, TB).is_none());
        assert_eq!(buffer.duration_seconds(), 0.0);
    }

    #[test]
    fn an_inverted_range_yields_no_clip() {
        let mut buffer = RingBuffer::new(30.0, TB);
        fill(&mut buffer, 600, 120, 500);
        assert!(buffer.extract(10 * TB, 2 * TB).is_none());
    }

    #[test]
    fn packets_come_back_in_order_and_intact() {
        let mut buffer = RingBuffer::new(30.0, TB);
        for i in 0..600 {
            let pts = i * TICKS_PER_FRAME;
            buffer.push(Packet {
                data: vec![(i % 251) as u8; 32].into(),
                pts,
                dts: pts,
                keyframe: i % 120 == 0,
            });
        }

        let clip = buffer.extract(0, 10 * TB).expect("clip");
        assert!(
            clip.packets.windows(2).all(|w| w[0].pts <= w[1].pts),
            "packets must stay in presentation order"
        );
        assert_eq!(
            clip.bytes,
            clip.packets.iter().map(|p| p.len() as u64).sum::<u64>(),
            "byte count must match the packets returned"
        );
    }

    #[test]
    fn a_shorter_gop_cuts_more_precisely() {
        let coarse = {
            let mut b = RingBuffer::new(30.0, TB);
            fill(&mut b, 1800, 240, 500);
            b.extract_around(25 * TB, 10.0, 0.0)
                .unwrap()
                .duration_seconds(TB)
        };
        let fine = {
            let mut b = RingBuffer::new(30.0, TB);
            fill(&mut b, 1800, 60, 500);
            b.extract_around(25 * TB, 10.0, 0.0)
                .unwrap()
                .duration_seconds(TB)
        };

        assert!(
            (fine - 10.0).abs() <= (coarse - 10.0).abs(),
            "a 1 s GOP ({fine:.2}s) should land closer to 10 s than a 4 s GOP ({coarse:.2}s)"
        );
    }
}
