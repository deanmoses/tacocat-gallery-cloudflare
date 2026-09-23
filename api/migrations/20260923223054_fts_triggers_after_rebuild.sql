-- The two rebuilds before this dropped item's triggers along with the table, so the FTS triggers from 0002 come
-- back here, and the index is rebuilt from the copied rows, whose ids the copies kept.
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

INSERT INTO item_fts (item_fts) VALUES ('rebuild');
