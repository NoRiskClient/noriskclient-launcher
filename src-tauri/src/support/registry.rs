use crate::support::handler::SupportItemHandler;
use crate::support::handlers::{
    logs, mc_settings, mod_list, nrc_profile, profile_summary, switch_pack, system_info,
    update_loader,
};
use once_cell::sync::Lazy;

pub struct Registry {
    handlers: Vec<Box<dyn SupportItemHandler>>,
}

impl Registry {
    fn new(handlers: Vec<Box<dyn SupportItemHandler>>) -> Self {
        for (i, handler) in handlers.iter().enumerate() {
            assert!(
                handlers[..i]
                    .iter()
                    .all(|h| h.type_id() != handler.type_id()),
                "support item type registered twice: {}",
                handler.type_id()
            );
        }
        Self { handlers }
    }

    pub fn get(&self, type_id: &str) -> Option<&dyn SupportItemHandler> {
        self.handlers
            .iter()
            .find(|h| h.type_id() == type_id)
            .map(|h| h.as_ref())
    }
}

pub static REGISTRY: Lazy<Registry> = Lazy::new(|| {
    let file_handlers = logs::handlers()
        .into_iter()
        .chain([mc_settings::HANDLER, nrc_profile::HANDLER])
        .map(|h| Box::new(h) as Box<dyn SupportItemHandler>);
    let other_handlers: [Box<dyn SupportItemHandler>; 5] = [
        Box::new(mod_list::ModListHandler),
        Box::new(profile_summary::ProfileSummaryHandler),
        Box::new(system_info::SystemInfoHandler),
        Box::new(update_loader::UpdateLoaderHandler),
        Box::new(switch_pack::SwitchPackHandler),
    ];
    Registry::new(file_handlers.chain(other_handlers).collect())
});

pub fn capabilities() -> Vec<String> {
    REGISTRY
        .handlers
        .iter()
        .map(|h| h.type_id().to_string())
        .collect()
}
