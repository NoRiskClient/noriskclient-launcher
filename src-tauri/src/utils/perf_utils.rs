use log::info;
use std::time::Instant;

pub struct Phase {
    scope: &'static str,
    start: Instant,
    last: Instant,
}

impl Phase {
    pub fn start(scope: &'static str) -> Self {
        let now = Instant::now();
        Self {
            scope,
            start: now,
            last: now,
        }
    }

    pub fn mark(&mut self, label: &str) {
        let now = Instant::now();
        info!(
            "[perf:{}] {} took {}ms (total {}ms)",
            self.scope,
            label,
            now.duration_since(self.last).as_millis(),
            now.duration_since(self.start).as_millis()
        );
        self.last = now;
    }

    pub fn total_ms(&self) -> u128 {
        self.start.elapsed().as_millis()
    }
}

impl Drop for Phase {
    fn drop(&mut self) {
        info!("[perf:{}] done in {}ms", self.scope, self.total_ms());
    }
}
