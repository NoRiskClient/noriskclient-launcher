use super::model::ImportSelection;

pub struct Bucket {
    pub key: &'static str,
    pub entries: &'static [&'static str],
    pub selected: fn(&ImportSelection) -> bool,
    pub counts_directories: bool,
}

pub static BUCKETS: &[Bucket] = &[
    Bucket {
        key: "mods",
        entries: &["mods"],
        selected: |selection| selection.mods,
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
        counts_directories: false,
    },
    Bucket {
        key: "saves",
        entries: &["saves"],
        selected: |selection| selection.saves,
        counts_directories: true,
    },
    Bucket {
        key: "resourcepacks",
        entries: &["resourcepacks"],
        selected: |selection| selection.resourcepacks,
        counts_directories: false,
    },
    Bucket {
        key: "shaderpacks",
        entries: &["shaderpacks"],
        selected: |selection| selection.shaderpacks,
        counts_directories: false,
    },
    Bucket {
        key: "screenshots",
        entries: &["screenshots"],
        selected: |selection| selection.screenshots,
        counts_directories: false,
    },
];

pub const MODS: &str = "mods";

pub fn find(key: &str) -> Option<&'static Bucket> {
    BUCKETS.iter().find(|bucket| bucket.key == key)
}
