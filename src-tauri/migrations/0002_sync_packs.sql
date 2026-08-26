CREATE TABLE sync_packs (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    description TEXT    NULL,
    icon        TEXT    NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created     INTEGER NOT NULL,
    updated     INTEGER NOT NULL
);

CREATE TABLE sync_pack_targets (
    id            TEXT    PRIMARY KEY,
    pack_id       TEXT    NOT NULL,
    path          TEXT    NOT NULL,
    enabled       INTEGER NOT NULL DEFAULT 1,
    kind          TEXT    NOT NULL,
    external_path TEXT    NULL,

    UNIQUE (pack_id, path)
);

CREATE INDEX sync_pack_targets_pack_idx ON sync_pack_targets (pack_id);

CREATE TABLE sync_pack_mods (
    pack_id           TEXT NOT NULL,
    mod_id            TEXT NOT NULL,
    data              TEXT NOT NULL,
    resolve_mode      TEXT NOT NULL DEFAULT 'auto',
    version_overrides TEXT NOT NULL DEFAULT '{}',
    icon_url          TEXT NULL,

    PRIMARY KEY (pack_id, mod_id)
);

CREATE TABLE sync_pack_mod_resolutions (
    pack_id      TEXT    NOT NULL,
    project_key  TEXT    NOT NULL,
    mc_version   TEXT    NOT NULL,
    loader       TEXT    NOT NULL,
    version_id   TEXT    NOT NULL,
    version_name TEXT    NULL,
    filename     TEXT    NOT NULL,
    download_url TEXT    NOT NULL,
    sha1         TEXT    NULL,
    file_size    INTEGER NULL,
    resolved_at  INTEGER NOT NULL,

    PRIMARY KEY (pack_id, project_key, mc_version, loader)
);

CREATE INDEX sync_pack_mod_resolutions_pack_idx ON sync_pack_mod_resolutions (pack_id);

CREATE TABLE sync_pack_target_state (
    pack_id             TEXT    NOT NULL,
    target_path         TEXT    NOT NULL,
    last_sync           INTEGER NULL,
    content_sha1        TEXT    NULL,
    last_source_profile TEXT    NULL,

    PRIMARY KEY (pack_id, target_path)
);

CREATE TABLE sync_pack_adoptions (
    pack_id     TEXT NOT NULL,
    target_path TEXT NOT NULL,
    profile_id  TEXT NOT NULL,

    PRIMARY KEY (pack_id, target_path, profile_id)
);
