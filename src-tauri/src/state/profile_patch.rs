use crate::state::profile_state::{
    MemorySettings, ModLoader, NoriskInformation, Profile, WindowSize,
};
use serde::{Deserialize, Deserializer};
use std::collections::HashMap;
use uuid::Uuid;

fn nullable<'de, D, T>(deserializer: D) -> std::result::Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfilePatch {
    pub name: Option<String>,
    pub game_version: Option<String>,
    pub loader: Option<ModLoader>,
    #[serde(default, deserialize_with = "nullable")]
    pub loader_version: Option<Option<String>>,
    pub settings: Option<ProfileSettingsPatch>,
    #[serde(default, deserialize_with = "nullable")]
    pub selected_norisk_pack_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable")]
    pub group: Option<Option<String>>,
    pub use_shared_minecraft_folder: Option<bool>,
    #[serde(default, deserialize_with = "nullable")]
    pub description: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable")]
    pub norisk_information: Option<Option<NoriskInformation>>,
    #[serde(default, deserialize_with = "nullable")]
    pub preferred_account_id: Option<Option<Uuid>>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileSettingsPatch {
    #[serde(default, deserialize_with = "nullable")]
    pub java_path: Option<Option<String>>,
    pub use_custom_java_path: Option<bool>,
    pub use_overwrite_loader_version: Option<bool>,
    #[serde(default, deserialize_with = "nullable")]
    pub overwrite_loader_version: Option<Option<String>>,
    pub overwrite_loader_versions: Option<HashMap<String, String>>,
    pub memory: Option<MemorySettings>,
    #[serde(default, deserialize_with = "nullable")]
    pub resolution: Option<Option<WindowSize>>,
    pub fullscreen: Option<bool>,
    pub extra_game_args: Option<Vec<String>>,
    pub use_custom_jvm_args: Option<bool>,
    pub jvm_args: Option<String>,
    #[serde(default, deserialize_with = "nullable")]
    pub quick_play_path: Option<Option<String>>,
}

fn set<T>(target: &mut T, value: Option<T>) {
    if let Some(value) = value {
        *target = value;
    }
}

impl ProfilePatch {
    pub fn apply(self, profile: &mut Profile) {
        set(&mut profile.name, self.name);
        set(&mut profile.game_version, self.game_version);
        set(&mut profile.loader, self.loader);
        set(&mut profile.loader_version, self.loader_version);
        set(
            &mut profile.selected_norisk_pack_id,
            self.selected_norisk_pack_id,
        );
        set(&mut profile.group, self.group);
        set(
            &mut profile.use_shared_minecraft_folder,
            self.use_shared_minecraft_folder,
        );
        set(&mut profile.description, self.description);
        set(&mut profile.norisk_information, self.norisk_information);
        set(&mut profile.preferred_account_id, self.preferred_account_id);
        if let Some(settings) = self.settings {
            settings.apply(profile);
        }
    }
}

impl ProfileSettingsPatch {
    fn apply(self, profile: &mut Profile) {
        let settings = &mut profile.settings;
        set(&mut settings.java_path, self.java_path);
        set(
            &mut settings.use_custom_java_path,
            self.use_custom_java_path,
        );
        set(
            &mut settings.use_overwrite_loader_version,
            self.use_overwrite_loader_version,
        );
        set(
            &mut settings.overwrite_loader_version,
            self.overwrite_loader_version,
        );
        set(
            &mut settings.overwrite_loader_versions,
            self.overwrite_loader_versions,
        );
        set(&mut settings.memory, self.memory);
        set(&mut settings.resolution, self.resolution);
        set(&mut settings.fullscreen, self.fullscreen);
        set(&mut settings.extra_game_args, self.extra_game_args);
        set(&mut settings.use_custom_jvm_args, self.use_custom_jvm_args);
        set(&mut settings.jvm_args, self.jvm_args);
        set(&mut settings.quick_play_path, self.quick_play_path);

        if settings.use_overwrite_loader_version {
            if let Some(version) = settings
                .overwrite_loader_version
                .clone()
                .filter(|v| !v.is_empty())
            {
                settings
                    .overwrite_loader_versions
                    .insert(profile.loader.as_str().to_string(), version);
            }
        }
    }
}
