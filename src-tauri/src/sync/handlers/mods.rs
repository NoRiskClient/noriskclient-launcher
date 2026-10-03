use crate::error::Result;
use crate::sync::context::SyncContext;
use crate::sync::model::{jar_exclusion_key, mod_exclusion_key};
use crate::sync::handlers::SyncHandler;
use crate::sync::paths;
use crate::sync::report::HandlerOutcome;
use crate::sync::resolution;
use async_trait::async_trait;
use log::debug;

pub struct ModsHandler;

#[async_trait]
impl SyncHandler for ModsHandler {
    async fn apply_pre_launch(&self, ctx: &SyncContext<'_>) -> Result<HandlerOutcome> {
        let mut outcome = HandlerOutcome::unchanged();

        let resolution = resolution::resolve_pack_mods(
            ctx.manager,
            ctx.pack,
            &ctx.profile.game_version,
            ctx.profile.loader,
        )
        .await;

        let excluded = ctx
            .manager
            .get_profile_exclusions(ctx.profile.id)
            .await
            .unwrap_or_default()
            .remove(&ctx.pack.id)
            .unwrap_or_default();

        outcome.extra_mods = resolution
            .mods
            .into_iter()
            .filter(|m| !excluded.contains(&mod_exclusion_key(m.id)))
            .collect();
        outcome.warnings.extend(resolution.warnings);
        outcome.extra_local_jars = paths::list_pack_local_jars(ctx.pack.id)
            .await?
            .into_iter()
            .filter(|path| {
                path.file_name()
                    .map(|name| !excluded.contains(&jar_exclusion_key(&name.to_string_lossy())))
                    .unwrap_or(true)
            })
            .collect();

        debug!(
            "Sync pack '{}' contributes {} mod(s) and {} local jar(s)",
            ctx.pack.name,
            outcome.extra_mods.len(),
            outcome.extra_local_jars.len()
        );

        if !outcome.extra_mods.is_empty() || !outcome.extra_local_jars.is_empty() {
            outcome.messages.push(format!(
                "{} mod(s) and {} local jar(s) from '{}'",
                outcome.extra_mods.len(),
                outcome.extra_local_jars.len(),
                ctx.pack.name
            ));
        }

        Ok(outcome)
    }
}
