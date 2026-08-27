
CREATE TABLE profiles (
    id                          TEXT    PRIMARY KEY NOT NULL,
    name                        TEXT    NOT NULL,
    path                        TEXT    NOT NULL,
    game_version                TEXT    NOT NULL,
    loader                      TEXT    NOT NULL,
    loader_version              TEXT    NULL,
    created                     INTEGER NOT NULL,
    last_played                 INTEGER NULL,
    state                       TEXT    NOT NULL DEFAULT 'not_installed',
    selected_norisk_pack_id     TEXT    NULL,
    source_standard_profile_id  TEXT    NULL,
    group_name                  TEXT    NULL,
    use_shared_minecraft_folder INTEGER NOT NULL DEFAULT 0,
    is_standard_version         INTEGER NOT NULL DEFAULT 0,
    description                 TEXT    NULL,
    preferred_account_id        TEXT    NULL,
    playtime_seconds            INTEGER NOT NULL DEFAULT 0,

    settings                    TEXT    NOT NULL DEFAULT '{}',
    banner                      TEXT    NULL,
    background                  TEXT    NULL,
    norisk_information          TEXT    NULL,
    modpack_info                TEXT    NULL,

    extra                       TEXT    NOT NULL DEFAULT '{}',
    updated_at                  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX profiles_path_idx ON profiles (path);
CREATE INDEX profiles_group_idx ON profiles (group_name);
CREATE INDEX profiles_source_standard_idx
    ON profiles (source_standard_profile_id) WHERE source_standard_profile_id IS NOT NULL;

CREATE TABLE profile_mods (
    profile_id             TEXT    NOT NULL,
    id                     TEXT    NOT NULL,
    ordinal                INTEGER NOT NULL,

    source                 TEXT    NOT NULL,
    source_type            TEXT    NOT NULL,
    project_id             TEXT    NULL,
    version_id             TEXT    NULL,
    file_name              TEXT    NULL,

    enabled                INTEGER NOT NULL DEFAULT 1,
    display_name           TEXT    NULL,
    version                TEXT    NULL,
    game_versions          TEXT    NULL,
    file_name_override     TEXT    NULL,
    associated_loader      TEXT    NULL,
    modpack_origin         TEXT    NULL,
    updates_enabled        INTEGER NOT NULL DEFAULT 1,
    force_include_versions TEXT    NOT NULL DEFAULT '[]',
    extra                  TEXT    NOT NULL DEFAULT '{}',

    PRIMARY KEY (profile_id, id),
    FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE
);

CREATE INDEX profile_mods_profile_idx ON profile_mods (profile_id, ordinal);
CREATE INDEX profile_mods_project_idx
    ON profile_mods (source_type, project_id) WHERE project_id IS NOT NULL;

CREATE TABLE profile_disabled_norisk_mods (
    profile_id   TEXT NOT NULL,
    pack_id      TEXT NOT NULL,
    mod_id       TEXT NOT NULL,
    game_version TEXT NOT NULL,
    loader       TEXT NOT NULL,

    PRIMARY KEY (profile_id, pack_id, mod_id, game_version, loader),
    FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE
);

CREATE TABLE app_meta (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

CREATE TABLE profiles_legacy_import (
    id          TEXT    PRIMARY KEY NOT NULL,
    ordinal     INTEGER NOT NULL,
    raw         TEXT    NOT NULL,
    parsed      INTEGER NOT NULL DEFAULT 1,
    parse_error TEXT    NULL,
    imported_at INTEGER NOT NULL
);
