-- An album's summary is searched like a title, so the index gets the column, last so that snippet() still finds the
-- description at 2. An FTS5 table cannot add a column, so it is remade, with the triggers that feed it.
DROP TRIGGER item_ai;
DROP TRIGGER item_ad;
DROP TRIGGER item_au;
DROP TABLE item_fts;

CREATE VIRTUAL TABLE item_fts USING fts5(item_name, title, description, tags, summary, content='item', content_rowid='id');

CREATE TRIGGER item_ai AFTER INSERT ON item BEGIN
    INSERT INTO item_fts (rowid, item_name, title, description, tags, summary)
    VALUES (new.id, new.item_name, new.title, new.description, new.tags, new.summary);
END;

CREATE TRIGGER item_ad AFTER DELETE ON item BEGIN
    INSERT INTO item_fts (item_fts, rowid, item_name, title, description, tags, summary)
    VALUES ('delete', old.id, old.item_name, old.title, old.description, old.tags, old.summary);
END;

CREATE TRIGGER item_au AFTER UPDATE ON item BEGIN
    INSERT INTO item_fts (item_fts, rowid, item_name, title, description, tags, summary)
    VALUES ('delete', old.id, old.item_name, old.title, old.description, old.tags, old.summary);
    INSERT INTO item_fts (rowid, item_name, title, description, tags, summary)
    VALUES (new.id, new.item_name, new.title, new.description, new.tags, new.summary);
END;

INSERT INTO item_fts (item_fts) VALUES ('rebuild');
