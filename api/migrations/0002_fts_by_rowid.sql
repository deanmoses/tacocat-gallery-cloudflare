-- Keying the FTS table by column made every update and delete scan the whole index. External-content FTS
-- keyed by an integer rowid makes each trigger a point lookup. The prototype's data is synthetic, so the
-- tables are rebuilt rather than migrated.
DROP TRIGGER item_ai;
DROP TRIGGER item_ad;
DROP TRIGGER item_au;
DROP TABLE item_fts;
DROP TABLE item;

CREATE TABLE item (
    id INTEGER PRIMARY KEY,
    parent_path TEXT NOT NULL,
    item_name TEXT NOT NULL,
    item_type TEXT NOT NULL CHECK (item_type IN ('album', 'image', 'video')),
    title TEXT,
    description TEXT,
    tags TEXT,
    version_id TEXT,
    published INTEGER NOT NULL DEFAULT 0,
    updated_on TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (parent_path, item_name)
);

CREATE VIRTUAL TABLE item_fts USING fts5(item_name, title, description, tags, content='item', content_rowid='id');

CREATE TRIGGER item_ai AFTER INSERT ON item BEGIN
    INSERT INTO item_fts (rowid, item_name, title, description, tags)
    VALUES (new.id, new.item_name, new.title, new.description, new.tags);
END;

CREATE TRIGGER item_ad AFTER DELETE ON item BEGIN
    INSERT INTO item_fts (item_fts, rowid, item_name, title, description, tags)
    VALUES ('delete', old.id, old.item_name, old.title, old.description, old.tags);
END;

CREATE TRIGGER item_au AFTER UPDATE ON item BEGIN
    INSERT INTO item_fts (item_fts, rowid, item_name, title, description, tags)
    VALUES ('delete', old.id, old.item_name, old.title, old.description, old.tags);
    INSERT INTO item_fts (rowid, item_name, title, description, tags)
    VALUES (new.id, new.item_name, new.title, new.description, new.tags);
END;
