use super::model::ImportSelection;

pub struct Bucket {
    pub key: &'static str,
    pub entries: &'static [&'static str],
    pub selected: fn(&ImportSelection) -> bool,
    pub set: fn(&mut ImportSelection, bool),
    pub counts_directories: bool,
}

pub static BUCKETS: &[Bucket] = &[
    Bucket {
        key: "mods",
        entries: &["mods"],
        selected: |selection| selection.mods,
        set: |selection, value| selection.mods = value,
        counts_directories: false,
    },
    Bucket {
        key: "config",
        entries: &[
            "config",
            "defaultconfigs",
            "kubejs",
            "scripts",
            "patchouli_books",
        ],
        selected: |selection| selection.config,
        set: |selection, value| selection.config = value,
        counts_directories: false,
    },
    Bucket {
        key: "options",
        entries: &[
            "options.txt",
            "optionsof.txt",
            "optionsshaders.txt",
            "servers.dat",
        ],
        selected: |selection| selection.options,
        set: |selection, value| selection.options = value,
        counts_directories: false,
    },
    Bucket {
        key: "saves",
        entries: &["saves"],
        selected: |selection| selection.saves,
        set: |selection, value| selection.saves = value,
        counts_directories: true,
    },
    Bucket {
        key: "resourcepacks",
        entries: &["resourcepacks"],
        selected: |selection| selection.resourcepacks,
        set: |selection, value| selection.resourcepacks = value,
        counts_directories: false,
    },
    Bucket {
        key: "shaderpacks",
        entries: &["shaderpacks"],
        selected: |selection| selection.shaderpacks,
        set: |selection, value| selection.shaderpacks = value,
        counts_directories: false,
    },
    Bucket {
        key: "screenshots",
        entries: &["screenshots"],
        selected: |selection| selection.screenshots,
        set: |selection, value| selection.screenshots = value,
        counts_directories: false,
    },
];

pub const MODS: &str = "mods";
pub const SAVES: &str = "saves";

pub fn find(key: &str) -> Option<&'static Bucket> {
    BUCKETS.iter().find(|bucket| bucket.key == key)
}
