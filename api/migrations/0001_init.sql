-- Minimal slice of the gallery model: enough to test replica reads, FTS5 triggers and backups.
CREATE TABLE item (
    parent_path TEXT NOT NULL,
    item_name TEXT NOT NULL,
    item_type TEXT NOT NULL CHECK (item_type IN ('album', 'image', 'video')),
    title TEXT,
    description TEXT,
    tags TEXT,
    version_id TEXT,
    published INTEGER NOT NULL DEFAULT 0,
    updated_on TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (parent_path, item_name)
) WITHOUT ROWID;

-- External-content FTS needs a rowid, and item is WITHOUT ROWID, so the index keeps its own copy of the text.
CREATE VIRTUAL TABLE item_fts USING fts5(parent_path UNINDEXED, item_name, title, description, tags);

CREATE TRIGGER item_ai AFTER INSERT ON item BEGIN
    INSERT INTO item_fts (parent_path, item_name, title, description, tags)
    VALUES (new.parent_path, new.item_name, new.title, new.description, new.tags);
END;

CREATE TRIGGER item_ad AFTER DELETE ON item BEGIN
    DELETE FROM item_fts WHERE parent_path = old.parent_path AND item_name = old.item_name;
END;

CREATE TRIGGER item_au AFTER UPDATE ON item BEGIN
    DELETE FROM item_fts WHERE parent_path = old.parent_path AND item_name = old.item_name;
    INSERT INTO item_fts (parent_path, item_name, title, description, tags)
    VALUES (new.parent_path, new.item_name, new.title, new.description, new.tags);
END;
