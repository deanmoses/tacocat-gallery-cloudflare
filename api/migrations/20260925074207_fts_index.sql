-- resets: the migrations start over from one baseline, since no environment had been given the earlier ones: both
-- held only prototype data, emptied by hand before this was pushed, and the seventeen migrations before the reset had
-- rebuilt item three times.
--
-- The search index over items, kept in step by triggers. The update trigger fires only for the columns the index
-- holds, so a write that touches none of them, such as setting a thumbnail, publishing, pointing a row at a new
-- version or moving an album's children when it is renamed, leaves the index alone.
CREATE VIRTUAL TABLE item_fts USING fts5(item_name, title, description, tags, summary, content='item', content_rowid='id');

CREATE TRIGGER item_ai AFTER INSERT ON item BEGIN
    INSERT INTO item_fts (rowid, item_name, title, description, tags, summary)
    VALUES (new.id, new.item_name, new.title, new.description, new.tags, new.summary);
END;

CREATE TRIGGER item_ad AFTER DELETE ON item BEGIN
    INSERT INTO item_fts (item_fts, rowid, item_name, title, description, tags, summary)
    VALUES ('delete', old.id, old.item_name, old.title, old.description, old.tags, old.summary);
END;

CREATE TRIGGER item_au AFTER UPDATE OF item_name, title, description, tags, summary ON item BEGIN
    INSERT INTO item_fts (item_fts, rowid, item_name, title, description, tags, summary)
    VALUES ('delete', old.id, old.item_name, old.title, old.description, old.tags, old.summary);
    INSERT INTO item_fts (rowid, item_name, title, description, tags, summary)
    VALUES (new.id, new.item_name, new.title, new.description, new.tags, new.summary);
END;
