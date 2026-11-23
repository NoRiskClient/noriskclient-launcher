#[cfg(desktop)]
pub mod curseforge;
#[cfg(desktop)]
pub mod curseforge_export;
pub mod lenient;
#[cfg(desktop)]
pub mod mod_dependencies;
#[cfg(desktop)]
pub mod launcher_import;
#[cfg(desktop)]
pub mod mod_lookup;
#[cfg(desktop)]
pub mod modrinth;
#[cfg(desktop)]
pub mod mrpack;
#[cfg(desktop)]
pub mod mrpack_export;
#[cfg(desktop)]
pub mod norisk_packs;
#[cfg(desktop)]
pub mod norisk_versions;
#[cfg(desktop)]
pub mod pack_preview;
#[cfg(desktop)]
pub mod provenance;
#[cfg(desktop)]
pub mod unified_mod;

#[cfg(desktop)]
pub use norisk_packs::*;
#[cfg(desktop)]
pub use norisk_versions::*;
