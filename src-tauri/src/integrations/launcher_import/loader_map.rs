use crate::state::profile_state::ModLoader;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoaderPick {
    pub loader: ModLoader,
    pub loader_version: Option<String>,
    pub game_version: Option<String>,
    pub unrecognized: Option<String>,
}

impl LoaderPick {
    pub fn vanilla() -> Self {
        Self {
            loader: ModLoader::Vanilla,
            loader_version: None,
            game_version: None,
            unrecognized: None,
        }
    }

    fn known(loader: ModLoader, loader_version: Option<String>) -> Self {
        Self {
            loader,
            loader_version,
            game_version: None,
            unrecognized: None,
        }
    }

    fn unknown(raw: &str) -> Self {
        Self {
            loader: ModLoader::Vanilla,
            loader_version: None,
            game_version: None,
            unrecognized: Some(raw.to_string()),
        }
    }
}

fn non_empty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

pub fn loader_from_name(name: &str) -> Option<ModLoader> {
    match name.trim().to_ascii_lowercase().as_str() {
        "" | "vanilla" | "none" | "minecraft" => Some(ModLoader::Vanilla),
        "forge" => Some(ModLoader::Forge),
        "fabric" | "legacyfabric" | "legacy fabric" | "fabricmc" => Some(ModLoader::Fabric),
        "quilt" | "quiltmc" => Some(ModLoader::Quilt),
        "neoforge" | "neoforged" => Some(ModLoader::NeoForge),
        _ => None,
    }
}

pub fn loader_from_mmc_uid(uid: &str) -> Option<ModLoader> {
    match uid.trim().to_ascii_lowercase().as_str() {
        "net.neoforged" => Some(ModLoader::NeoForge),
        "net.minecraftforge" => Some(ModLoader::Forge),
        "net.fabricmc.fabric-loader" => Some(ModLoader::Fabric),
        "org.quiltmc.quilt-loader" => Some(ModLoader::Quilt),
        _ => None,
    }
}

pub fn loader_from_curseforge_name(name: &str) -> LoaderPick {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return LoaderPick::vanilla();
    }

    let (head, rest) = match trimmed.split_once('-') {
        Some((head, rest)) => (head, rest),
        None => (trimmed, ""),
    };

    match loader_from_name(head) {
        Some(ModLoader::Vanilla) => LoaderPick::vanilla(),
        Some(loader) => LoaderPick::known(loader, non_empty(rest)),
        None => LoaderPick::unknown(trimmed),
    }
}

pub fn loader_from_vanilla_version_id(version_id: &str) -> LoaderPick {
    let trimmed = version_id.trim();
    if trimmed.is_empty() {
        return LoaderPick::vanilla();
    }
    let lower = trimmed.to_ascii_lowercase();

    for (prefix, loader) in [
        ("fabric-loader-", ModLoader::Fabric),
        ("quilt-loader-", ModLoader::Quilt),
    ] {
        if let Some(rest) = lower.strip_prefix(prefix) {
            let (loader_version, game_version) = match rest.split_once('-') {
                Some((lv, mc)) => (non_empty(lv), non_empty(mc)),
                None => (non_empty(rest), None),
            };
            return LoaderPick {
                loader,
                loader_version,
                game_version,
                unrecognized: None,
            };
        }
    }

    for (marker, loader) in [("-neoforge-", ModLoader::NeoForge), ("-forge-", ModLoader::Forge)] {
        if let Some((mc, lv)) = lower.split_once(marker) {
            return LoaderPick {
                loader,
                loader_version: non_empty(lv),
                game_version: non_empty(mc),
                unrecognized: None,
            };
        }
    }

    for (prefix, loader) in [("neoforge-", ModLoader::NeoForge), ("forge-", ModLoader::Forge)] {
        if let Some(rest) = lower.strip_prefix(prefix) {
            return LoaderPick {
                loader,
                loader_version: non_empty(rest),
                game_version: None,
                unrecognized: None,
            };
        }
    }

    LoaderPick {
        loader: ModLoader::Vanilla,
        loader_version: None,
        game_version: is_version_like(trimmed).then(|| trimmed.to_string()),
        unrecognized: (!is_version_like(trimmed)).then(|| trimmed.to_string()),
    }
}

pub fn is_version_like(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty()
        && trimmed.starts_with(|c: char| c.is_ascii_digit())
        && trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '+'))
}
