CREATE TABLE profile_sync_mod_exclusions (
    profile_id TEXT NOT NULL,
    pack_id    TEXT NOT NULL,
    mod_key    TEXT NOT NULL,

    PRIMARY KEY (profile_id, pack_id, mod_key),
    FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE
);
