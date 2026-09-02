use std::collections::VecDeque;

use super::Packet;

pub struct AudioRing {
    packets: VecDeque<Packet>,
    window_ticks: i64,
    time_base_den: i64,
    bytes: u64,
}

impl AudioRing {
    pub fn new(window_seconds: f32, time_base_den: i64) -> Self {
        let window = (window_seconds.max(0.0) as f64 * time_base_den as f64) as i64;
        Self {
            packets: VecDeque::new(),
            window_ticks: window.max(1),
            time_base_den,
            bytes: 0,
        }
    }

    pub fn push(&mut self, packet: Packet) {
        self.bytes += packet.len() as u64;
        self.packets.push_back(packet);
        self.trim();
    }

    fn trim(&mut self) {
        let Some(newest) = self.packets.back().map(|p| p.pts) else {
            return;
        };
        let keep_from = newest - self.window_ticks - self.slack_ticks();

        while let Some(front) = self.packets.front() {
            if front.pts < keep_from {
                self.bytes -= front.len() as u64;
                self.packets.pop_front();
            } else {
                break;
            }
        }
    }

    fn slack_ticks(&self) -> i64 {
        self.time_base_den * 3
    }

    pub fn extract(&self, from_pts: i64, to_pts: i64) -> Vec<Packet> {
        if to_pts < from_pts || self.packets.is_empty() {
            return Vec::new();
        }

        let first = self
            .packets
            .iter()
            .rposition(|p| p.pts <= from_pts)
            .unwrap_or(0);

        self.packets
            .iter()
            .skip(first)
            .take_while(|p| p.pts <= to_pts)
            .cloned()
            .collect()
    }

    pub fn bytes(&self) -> u64 {
        self.bytes
    }

    pub fn len(&self) -> usize {
        self.packets.len()
    }

    pub fn is_empty(&self) -> bool {
        self.packets.is_empty()
    }

    pub fn duration_seconds(&self) -> f64 {
        match (self.packets.front(), self.packets.back()) {
            (Some(first), Some(last)) => {
                (last.pts - first.pts) as f64 / self.time_base_den as f64
            }
            _ => 0.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TB: i64 = 90_000;
    const AAC_TICKS: i64 = 1024 * TB / 48_000; // 1920

    fn fill(ring: &mut AudioRing, frames: i64, bytes_each: usize) {
        for i in 0..frames {
            ring.push(Packet {
                data: vec![0u8; bytes_each].into(),
                pts: i * AAC_TICKS,
                dts: i * AAC_TICKS,
                keyframe: true,
            });
        }
    }

    #[test]
    fn the_window_bounds_what_is_kept() {
        let mut ring = AudioRing::new(10.0, TB);
        fill(&mut ring, 60 * 48_000 / 1024, 400);

        let held = ring.duration_seconds();
        assert!(held >= 10.0, "must hold the window, held {held:.1}s");
        assert!(held <= 14.0, "grew past window + slack: {held:.1}s");
    }

    #[test]
    fn audio_memory_is_negligible_next_to_video() {
        let mut ring = AudioRing::new(30.0, TB);
        fill(&mut ring, 10 * 60 * 48_000 / 1024, 420);

        let mb = ring.bytes() as f64 / 1e6;
        assert!(
            mb < 3.0,
            "30 s of AAC should be well under a megabyte or two, got {mb:.2} MB"
        );
    }

    #[test]
    fn extraction_covers_the_requested_range() {
        let mut ring = AudioRing::new(30.0, TB);
        fill(&mut ring, 30 * 48_000 / 1024, 400);

        let from = 10 * TB;
        let to = 20 * TB;
        let packets = ring.extract(from, to);

        assert!(!packets.is_empty());
        assert!(packets[0].pts <= from);
        assert!(packets.last().unwrap().pts <= to);

        let span = (packets.last().unwrap().pts - packets[0].pts) as f64 / TB as f64;
        assert!(
            (span - 10.0).abs() < 0.1,
            "expected about 10 s of audio, got {span:.2}s"
        );
    }

    #[test]
    fn extraction_starts_before_the_request_not_after() {
        let mut ring = AudioRing::new(30.0, TB);
        fill(&mut ring, 1000, 400);

        let from = AAC_TICKS * 10 + AAC_TICKS / 2;
        let packets = ring.extract(from, from + TB);
        assert!(packets[0].pts <= from);
    }

    #[test]
    fn an_empty_ring_extracts_nothing() {
        let ring = AudioRing::new(30.0, TB);
        assert!(ring.extract(0, TB).is_empty());
        assert_eq!(ring.duration_seconds(), 0.0);
    }

    #[test]
    fn an_inverted_range_extracts_nothing() {
        let mut ring = AudioRing::new(30.0, TB);
        fill(&mut ring, 500, 400);
        assert!(ring.extract(10 * TB, 2 * TB).is_empty());
    }

    #[test]
    fn packets_come_back_in_order() {
        let mut ring = AudioRing::new(30.0, TB);
        fill(&mut ring, 500, 400);
        let packets = ring.extract(0, 5 * TB);
        assert!(packets.windows(2).all(|w| w[0].pts <= w[1].pts));
    }
}
