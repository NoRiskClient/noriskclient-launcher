-- Generic key/value cache. One row per cached item, so a write costs one row instead of
-- rewriting the whole store.
--
-- id + alias are COLLATE NOCASE so lookups stay case-insensitive (matching the previous
-- eq_ignore_ascii_case behaviour) while still using the indexes.
--
-- data IS NULL is a negative cache entry ("we asked, it does not exist") and is deliberately
-- distinct from a missing row ("we never asked").
--
-- expires is an absolute epoch-ms. Readers must NOT filter on it: stale-while-revalidate
-- depends on being able to serve expired rows. Freshness is decided in Rust.
CREATE TABLE cache (
    id         TEXT    NOT NULL COLLATE NOCASE,
    data_type  TEXT    NOT NULL,
    alias      TEXT    NULL     COLLATE NOCASE,
    data       TEXT    NULL,
    expires    INTEGER NOT NULL,

    PRIMARY KEY (id, data_type),
    UNIQUE (data_type, alias)
);

CREATE INDEX cache_expires_idx ON cache (data_type, expires);
