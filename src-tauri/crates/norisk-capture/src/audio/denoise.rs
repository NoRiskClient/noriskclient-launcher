use std::collections::VecDeque;

use nnnoiseless::DenoiseState;

const FRAME: usize = DenoiseState::FRAME_SIZE;
const SAMPLE_RATE: u32 = 48_000;
const SCALE: f32 = 32768.0;

pub fn works_at(sample_rate: u32) -> bool {
    let works = sample_rate == SAMPLE_RATE;
    if !works {
        log::warn!("Noise suppression needs a {SAMPLE_RATE} Hz microphone, this one runs at {sample_rate} Hz, so it is recorded without");
    }
    works
}

pub struct Denoiser {
    channels: usize,
    states: Vec<Box<DenoiseState<'static>>>,
    waiting: Vec<VecDeque<f32>>,
    cleaned: Vec<VecDeque<f32>>,
}

impl Denoiser {
    pub fn new(channels: u16) -> Self {
        let channels = channels.max(1) as usize;
        Self {
            channels,
            states: (0..channels).map(|_| DenoiseState::new()).collect(),
            waiting: vec![VecDeque::new(); channels],
            cleaned: vec![VecDeque::from(vec![0.0; FRAME]); channels],
        }
    }

    pub fn process(&mut self, samples: &mut [f32]) {
        if samples.is_empty() || samples.len() % self.channels != 0 {
            return;
        }

        for (index, sample) in samples.iter().enumerate() {
            self.waiting[index % self.channels].push_back(*sample * SCALE);
        }

        let mut input = [0.0f32; FRAME];
        let mut output = [0.0f32; FRAME];
        for channel in 0..self.channels {
            while self.waiting[channel].len() >= FRAME {
                for slot in input.iter_mut() {
                    *slot = self.waiting[channel].pop_front().unwrap_or(0.0);
                }
                self.states[channel].process_frame(&mut output, &input);
                self.cleaned[channel].extend(output.iter().copied());
            }
        }

        for (index, sample) in samples.iter_mut().enumerate() {
            let channel = index % self.channels;
            let value = self.cleaned[channel].pop_front().unwrap_or(0.0);
            *sample = (value / SCALE).clamp(-1.0, 1.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(frames: usize, channels: usize, amplitude: f32) -> Vec<f32> {
        (0..frames * channels)
            .map(|index| {
                let frame = (index / channels) as f32;
                amplitude * (frame * 2.0 * std::f32::consts::PI * 440.0 / 48_000.0).sin()
            })
            .collect()
    }

    fn loudness(samples: &[f32]) -> f32 {
        if samples.is_empty() {
            return 0.0;
        }
        (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
    }

    #[test]
    fn a_block_comes_back_exactly_as_long_as_it_went_in() {
        let mut denoiser = Denoiser::new(2);
        for frames in [480, 1, 999, 480, 123] {
            let mut block = tone(frames, 2, 0.3);
            let before = block.len();
            denoiser.process(&mut block);
            assert_eq!(block.len(), before, "{frames} frames changed length");
        }
    }

    #[test]
    fn a_block_that_does_not_divide_into_channels_is_left_alone() {
        let mut denoiser = Denoiser::new(2);
        let mut block = vec![0.5f32; 7];
        denoiser.process(&mut block);
        assert_eq!(block, vec![0.5f32; 7]);
    }

    #[test]
    fn silence_stays_silent() {
        let mut denoiser = Denoiser::new(1);
        let mut block = vec![0.0f32; FRAME * 4];
        denoiser.process(&mut block);
        assert!(block.iter().all(|s| s.abs() < 1e-6), "silence gained noise");
    }

    #[test]
    fn the_sound_comes_out_exactly_one_frame_late() {
        let mut denoiser = Denoiser::new(1);
        let spare = 20;
        let mut block = tone(FRAME + spare, 1, 0.5);
        denoiser.process(&mut block);

        assert_eq!(block.len(), FRAME + spare);
        assert!(
            block[..FRAME].iter().all(|s| *s == 0.0),
            "expected one frame of lead-in silence",
        );
        assert!(
            block[FRAME..].iter().any(|s| s.abs() > 1e-6),
            "everything after the lead-in was silent",
        );
    }

    #[test]
    fn hiss_is_quietened_more_than_a_voice_like_tone() {
        let mut on_hiss = Denoiser::new(1);
        let mut on_tone = Denoiser::new(1);

        let mut seed = 0x2545F491_4F6CDD1Du64;
        let mut hiss: Vec<f32> = (0..FRAME * 40)
            .map(|_| {
                seed ^= seed << 13;
                seed ^= seed >> 7;
                seed ^= seed << 17;
                ((seed >> 40) as f32 / 8388608.0) - 1.0
            })
            .map(|s| s * 0.2)
            .collect();
        let mut voice = tone(FRAME * 40, 1, 0.2);

        let hiss_before = loudness(&hiss);
        let voice_before = loudness(&voice);
        on_hiss.process(&mut hiss);
        on_tone.process(&mut voice);

        let hiss_kept = loudness(&hiss) / hiss_before;
        let voice_kept = loudness(&voice) / voice_before;

        assert!(
            hiss_kept < voice_kept,
            "hiss kept {hiss_kept:.3} of its level, the tone kept {voice_kept:.3}",
        );
    }

    #[test]
    #[ignore = "measures speed, so it only means something in a release build"]
    fn cleaning_costs_a_small_fraction_of_the_time_it_covers() {
        let seconds = 60;
        let channels = 2;
        let mut denoiser = Denoiser::new(channels as u16);
        let mut block = tone(480, channels, 0.2);

        let blocks = seconds * 48_000 / 480;
        let started = std::time::Instant::now();
        for _ in 0..blocks {
            denoiser.process(&mut block);
        }
        let spent = started.elapsed();

        let share = spent.as_secs_f64() / seconds as f64;
        println!(
            "{channels} channels, {seconds}s of audio in {:.0} ms, {:.2}% of one core",
            spent.as_secs_f64() * 1000.0,
            share * 100.0,
        );
        assert!(share < 0.15, "took {:.1}% of one core", share * 100.0);
    }

    #[test]
    fn every_channel_is_cleaned_on_its_own() {
        let mut denoiser = Denoiser::new(2);
        let mut block = vec![0.0f32; FRAME * 8 * 2];
        for frame in 0..FRAME * 8 {
            block[frame * 2] = 0.4 * (frame as f32 * 0.05).sin();
        }

        denoiser.process(&mut block);

        let right: Vec<f32> = block.iter().skip(1).step_by(2).copied().collect();
        assert!(
            right.iter().all(|s| s.abs() < 1e-6),
            "a silent channel picked up sound from the other one",
        );
    }
}
