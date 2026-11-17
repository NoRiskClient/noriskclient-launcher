use dashmap::DashMap;
use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use uuid::Uuid;

static CANCELS: Lazy<DashMap<Uuid, Arc<AtomicBool>>> = Lazy::new(DashMap::new);

pub struct CancelGuard {
    event_id: Option<Uuid>,
    flag: Arc<AtomicBool>,
}

impl CancelGuard {
    pub fn flag(&self) -> Arc<AtomicBool> {
        self.flag.clone()
    }
}

impl Drop for CancelGuard {
    fn drop(&mut self) {
        if let Some(event_id) = self.event_id {
            CANCELS.remove(&event_id);
        }
    }
}

pub fn register(event_id: Option<Uuid>) -> CancelGuard {
    let flag = Arc::new(AtomicBool::new(false));

    if let Some(event_id) = event_id {
        CANCELS.insert(event_id, flag.clone());
    }

    CancelGuard { event_id, flag }
}

pub fn cancel(event_id: Uuid) -> bool {
    match CANCELS.get(&event_id) {
        Some(flag) => {
            flag.store(true, Ordering::SeqCst);
            true
        }
        None => false,
    }
}

pub fn is_cancelled(flag: &AtomicBool) -> bool {
    flag.load(Ordering::SeqCst)
}
