-- The first of three migrations that rebuild item, here for the position check and the position index. SQLite changes
-- a check constraint only by rebuilding the table, which the next migration does as drizzle-kit generated it, and D1
-- never lets a migration turn foreign keys off, so when that rebuild drops the old table it deletes the rows first and
-- every ON DELETE SET NULL pointing at them fires: the albums' thumbnails in the new table, which still references the
-- old one at that point, and the uploads' album and target links. The links are copied aside here, into tables keyed
-- so that writing them back is a seek per row, and the migration after the rebuild writes them back and makes the
-- search index again. Its view over item goes now, because on D1 the rebuild's last step, giving the new table the
-- old name, fails while a view names a table that is gone ("error in view item_indexed: no such table: main.item");
-- the triggers go with the table.
--
-- Between this migration and the third, seconds apart within one `d1 migrations apply`, search finds nothing, and an
-- insert, a delete or an update of an indexed column fails, since the triggers select from the view. Other writes go
-- through: a thumbnail set in that window is kept, since the restore fills only links the rebuild cleared, but an upload
-- row made in it is not in the copy and loses its album and target links.
DROP VIEW item_indexed;

CREATE TABLE rebuild_item_thumbnail (id INTEGER PRIMARY KEY, thumbnail_id INTEGER NOT NULL);
INSERT INTO rebuild_item_thumbnail SELECT id, thumbnail_id FROM item WHERE thumbnail_id IS NOT NULL;

CREATE TABLE rebuild_upload_link (version_id TEXT PRIMARY KEY, album_id INTEGER, target_id INTEGER) WITHOUT ROWID;
INSERT INTO rebuild_upload_link SELECT version_id, album_id, target_id FROM upload WHERE album_id IS NOT NULL OR target_id IS NOT NULL;
