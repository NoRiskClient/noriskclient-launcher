use std::collections::VecDeque;
use std::time::{Duration, Instant};

use super::target::Aim;

pub(super) const TROUBLE_WINDOW: Duration = Duration::from_secs(120);
pub(super) const TROUBLE_LIMIT: usize = 3;
const FIRST_REST: Duration = Duration::from_secs(60);

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Verdict {
    Report,
    Quiet,
    Rest(Duration),
}

#[derive(Default)]
pub(super) struct Trouble {
    aim: Option<Aim>,
    recent: VecDeque<Instant>,
    rests: u32,
    resting_until: Option<Instant>,
}

impl Trouble {
    pub(super) fn note(&mut self, aim: &Aim, now: Instant) -> Verdict {
        if self.aim.as_ref() != Some(aim) {
            *self = Trouble {
                aim: Some(aim.clone()),
                ..Default::default()
            };
        }
        self.recent.retain(|at| now.saturating_duration_since(*at) < TROUBLE_WINDOW);
        self.recent.push_back(now);

        if self.recent.len() >= TROUBLE_LIMIT {
            let rest = FIRST_REST * 2u32.pow(self.rests.min(3));
            self.rests += 1;
            self.recent.clear();
            self.resting_until = Some(now + rest);
            return Verdict::Rest(rest);
        }
        if self.recent.len() == 1 {
            Verdict::Report
        } else {
            Verdict::Quiet
        }
    }

    pub(super) fn rest_ends(&self, aim: &Aim, now: Instant) -> Option<Instant> {
        self.resting_until
            .filter(|until| self.aim.as_ref() == Some(aim) && now < *until)
    }

    pub(super) fn resting_at_all(&self, now: Instant) -> bool {
        self.resting_until.is_some_and(|until| now < until)
    }

    pub(super) fn retry_in(&self, now: Instant) -> Option<u32> {
        self.resting_until
            .filter(|until| now < *until)
            .map(|until| until.saturating_duration_since(now).as_secs_f64().ceil() as u32)
    }

    pub(super) fn has_history(&self) -> bool {
        self.rests + self.recent.len() as u32 > 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game(pid: u32) -> Aim {
        Aim::Process(pid)
    }

    #[test]
    fn a_single_failure_is_reported_and_the_next_ones_stay_quiet() {
        let mut trouble = Trouble::default();
        let now = Instant::now();

        assert_eq!(trouble.note(&game(7), now), Verdict::Report);
        assert_eq!(trouble.note(&game(7), now + Duration::from_secs(5)), Verdict::Quiet);
        assert!(trouble.rest_ends(&game(7), now + Duration::from_secs(5)).is_none());
    }

    #[test]
    fn repeated_failures_rest_longer_each_time_up_to_a_ceiling() {
        let mut trouble = Trouble::default();
        let mut now = Instant::now();
        let mut rests = Vec::new();

        for _ in 0..5 {
            let mut verdict = Verdict::Quiet;
            for _ in 0..TROUBLE_LIMIT {
                now += Duration::from_secs(1);
                verdict = trouble.note(&game(7), now);
            }
            let Verdict::Rest(rest) = verdict else {
                panic!("{TROUBLE_LIMIT} quick failures did not lead to a rest");
            };
            assert!(trouble.rest_ends(&game(7), now).is_some());
            assert_eq!(trouble.retry_in(now), Some(rest.as_secs() as u32));
            assert!(trouble.rest_ends(&game(8), now).is_none(), "another game should not wait");
            rests.push(rest.as_secs());
            now += rest;
            assert!(trouble.rest_ends(&game(7), now).is_none(), "the rest never ended");
            assert_eq!(trouble.retry_in(now), None);
        }

        assert_eq!(rests, vec![60, 120, 240, 480, 480]);
    }

    #[test]
    fn failures_spread_far_apart_never_add_up_to_a_rest() {
        let mut trouble = Trouble::default();
        let mut now = Instant::now();

        for _ in 0..10 {
            now += TROUBLE_WINDOW;
            assert_eq!(trouble.note(&game(7), now), Verdict::Report);
        }
    }

    #[test]
    fn another_game_starts_with_a_clean_slate() {
        let mut trouble = Trouble::default();
        let now = Instant::now();

        trouble.note(&game(7), now);
        trouble.note(&game(7), now);
        assert_eq!(trouble.note(&game(8), now), Verdict::Report);
    }

    #[test]
    fn every_screen_keeps_its_own_history_apart_from_games() {
        let mut trouble = Trouble::default();
        let now = Instant::now();
        let screen = Aim::Screen("DISPLAY1".into());

        trouble.note(&screen, now);
        trouble.note(&screen, now);
        assert_eq!(trouble.note(&Aim::Screen("DISPLAY2".into()), now), Verdict::Report);
        assert_eq!(trouble.note(&game(0), now), Verdict::Report);
    }

    #[test]
    fn the_end_of_a_rest_is_only_known_for_the_resting_aim() {
        let mut trouble = Trouble::default();
        let now = Instant::now();

        for _ in 0..TROUBLE_LIMIT {
            trouble.note(&game(7), now);
        }
        assert_eq!(trouble.rest_ends(&game(7), now), Some(now + FIRST_REST));
        assert_eq!(trouble.rest_ends(&game(8), now), None);
        assert_eq!(trouble.rest_ends(&game(7), now + FIRST_REST), None);
    }
}
