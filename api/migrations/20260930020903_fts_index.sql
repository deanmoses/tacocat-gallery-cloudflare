-- non-additive: the search index file drops its own tables before making them, which on the bare database a baseline runs against removes nothing.
-- resets: the migrations start over from one baseline for the third time, since the version id format changed to a
-- ULID, which SQLite can only hold item and upload to by rebuilding them; with both databases emptied by hand, since
-- no row in them was in the new format and nothing in them mattered, a baseline was cheaper than the three-migration
-- rebuild. From the blank line on this file is src/db/search-index.sql verbatim.

-- The search index: a view of item, two FTS5 tables over the view, and the triggers that keep them in step with item.
-- Drizzle models none of these, so this file is their definition, and a migration that touches them is a copy of it.
-- Dropping item drops its triggers, and the view has to go before item is rebuilt, so every rebuild of item ends with
-- this file as a migration, and a test holds the file to what the migrations leave in the database.
--
-- The search indexes are built over a view of item rather than over item itself, so that what is indexed can be
-- computed in SQL and the triggers, the rebuild and a restore all agree on it:
--
-- - Every column gets a space wherever a letter meets a digit, so 'pat' and '1' are both words of 'pat1'; the
--   tokenizer already splits on '_' and '-', so nothing else is needed for 'pat_1' or 'img_0715'. A search splits its
--   own words the same way, so 'pat1' finds it too. SQLite has no regular expressions, so the split is done with
--   replace(): each digit is padded with spaces, and the double space that leaves between two digits is taken out
--   again so a run of digits stays one word. Spaces are first turned into underscores, which the tokenizer also
--   splits on, so that two words a space apart cannot be joined by that.
-- - `tags` carries the media-type words 'photo image picture' or 'movie video clip' beside the item's own tags, so a
--   search for 'felix video' finds the videos of Felix and no photos.
--
-- There are two indexes over the view. item_fts uses the porter stemmer over unicode61, which folds case and accents,
-- so that 'beach' finds 'beaches' and 'ecole' finds 'École'; a word or a phrase is matched there, and goes through the
-- same stemmer. item_fts_exact uses unicode61 alone, and a prefix is matched there against the words as typed: the
-- stemmer stems a prefix too, and 'vacati' stemmed is still 'vacati', which is no prefix of 'vacat', the stem of
-- 'vacation'. RediSearch held both forms of every word for the same reason.
--
-- The triggers select the row from the view, so the computation lives in the view alone. The delete side of an update
-- and a delete run BEFORE the change, while the view can still return the row as it was indexed, which FTS5 needs to
-- take the old entry out. Each trigger reads the row once per index; the view's expressions read nothing. The update
-- triggers fire only for the columns the view reads, so a write that touches none of them, such as setting a
-- thumbnail, publishing, pointing a row at a new version or moving an album's children when it is renamed, leaves the
-- indexes alone.
--
-- The index tables are dropped and made again rather than kept, since a rebuild of item leaves them holding entries
-- for a table that no longer exists, and FTS5 rebuilds them from the view at the end.
DROP TRIGGER IF EXISTS item_ai;
DROP TRIGGER IF EXISTS item_bd;
DROP TRIGGER IF EXISTS item_bu;
DROP TRIGGER IF EXISTS item_au;
DROP TABLE IF EXISTS item_fts;
DROP TABLE IF EXISTS item_fts_exact;
DROP VIEW IF EXISTS item_indexed;

CREATE VIEW item_indexed AS
SELECT id,
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(item_name, ' ', '_'), '0', ' 0 '), '1', ' 1 '), '2', ' 2 '), '3', ' 3 '), '4', ' 4 '), '5', ' 5 '), '6', ' 6 '), '7', ' 7 '), '8', ' 8 '), '9', ' 9 '), '  ', '') AS name,
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(title, ' ', '_'), '0', ' 0 '), '1', ' 1 '), '2', ' 2 '), '3', ' 3 '), '4', ' 4 '), '5', ' 5 '), '6', ' 6 '), '7', ' 7 '), '8', ' 8 '), '9', ' 9 '), '  ', '') AS title,
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(description, ' ', '_'), '0', ' 0 '), '1', ' 1 '), '2', ' 2 '), '3', ' 3 '), '4', ' 4 '), '5', ' 5 '), '6', ' 6 '), '7', ' 7 '), '8', ' 8 '), '9', ' 9 '), '  ', '') AS description,
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(coalesce(tags, ''), ' ', '_'), '0', ' 0 '), '1', ' 1 '), '2', ' 2 '), '3', ' 3 '), '4', ' 4 '), '5', ' 5 '), '6', ' 6 '), '7', ' 7 '), '8', ' 8 '), '9', ' 9 '), '  ', '') || CASE media_type WHEN 'image' THEN ' photo image picture' WHEN 'video' THEN ' movie video clip' ELSE '' END AS tags,
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(summary, ' ', '_'), '0', ' 0 '), '1', ' 1 '), '2', ' 2 '), '3', ' 3 '), '4', ' 4 '), '5', ' 5 '), '6', ' 6 '), '7', ' 7 '), '8', ' 8 '), '9', ' 9 '), '  ', '') AS summary
FROM item;

CREATE VIRTUAL TABLE item_fts USING fts5(name, title, description, tags, summary, content='item_indexed', content_rowid='id', tokenize='porter unicode61');
CREATE VIRTUAL TABLE item_fts_exact USING fts5(name, title, description, tags, summary, content='item_indexed', content_rowid='id', tokenize='unicode61');

CREATE TRIGGER item_ai AFTER INSERT ON item BEGIN
    INSERT INTO item_fts (rowid, name, title, description, tags, summary)
    SELECT id, name, title, description, tags, summary FROM item_indexed WHERE id = new.id;
    INSERT INTO item_fts_exact (rowid, name, title, description, tags, summary)
    SELECT id, name, title, description, tags, summary FROM item_indexed WHERE id = new.id;
END;

CREATE TRIGGER item_bd BEFORE DELETE ON item BEGIN
    INSERT INTO item_fts (item_fts, rowid, name, title, description, tags, summary)
    SELECT 'delete', id, name, title, description, tags, summary FROM item_indexed WHERE id = old.id;
    INSERT INTO item_fts_exact (item_fts_exact, rowid, name, title, description, tags, summary)
    SELECT 'delete', id, name, title, description, tags, summary FROM item_indexed WHERE id = old.id;
END;

CREATE TRIGGER item_bu BEFORE UPDATE OF item_name, media_type, title, description, tags, summary ON item BEGIN
    INSERT INTO item_fts (item_fts, rowid, name, title, description, tags, summary)
    SELECT 'delete', id, name, title, description, tags, summary FROM item_indexed WHERE id = old.id;
    INSERT INTO item_fts_exact (item_fts_exact, rowid, name, title, description, tags, summary)
    SELECT 'delete', id, name, title, description, tags, summary FROM item_indexed WHERE id = old.id;
END;

CREATE TRIGGER item_au AFTER UPDATE OF item_name, media_type, title, description, tags, summary ON item BEGIN
    INSERT INTO item_fts (rowid, name, title, description, tags, summary)
    SELECT id, name, title, description, tags, summary FROM item_indexed WHERE id = new.id;
    INSERT INTO item_fts_exact (rowid, name, title, description, tags, summary)
    SELECT id, name, title, description, tags, summary FROM item_indexed WHERE id = new.id;
END;

INSERT INTO item_fts (item_fts) VALUES ('rebuild');
INSERT INTO item_fts_exact (item_fts_exact) VALUES ('rebuild');
