CREATE TABLE legal_acceptances (
    slug        TEXT    NOT NULL,
    locale      TEXT    NOT NULL,
    version     INTEGER NOT NULL,
    accepted_at INTEGER NOT NULL,

    PRIMARY KEY (slug, locale)
);
