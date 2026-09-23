-- non-additive: item_type's allowed values change, and SQLite can only change a check constraint by rebuilding the
-- table. The prototype has no readers and no older Worker to overlap with.
--
-- An item is an album or a media item, and a media item is an image or a video. Rows that carried 'image' or 'video'
-- in item_type carry 'media' there and the kind in media_type, so code that treats every kind of media alike asks
-- one column.
--
-- This rebuild only reshapes the rows. The next migration is drizzle-kit's own rebuild for the same schema change,
-- which cannot run against the old table (it copies media_type, which the old table lacks) but is what records the
-- change in drizzle-kit's snapshot. Dropping a table drops its triggers, so the migration after that recreates the
-- FTS triggers and rebuilds the index.
CREATE TABLE item_reshaped (
    id INTEGER PRIMARY KEY,
    parent_path TEXT NOT NULL,
    item_name TEXT NOT NULL,
    item_type TEXT NOT NULL CHECK (item_type IN ('album', 'media')),
    media_type TEXT,
    title TEXT,
    description TEXT,
    tags TEXT,
    version_id TEXT,
    published INTEGER NOT NULL DEFAULT 0,
    updated_on TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    width INTEGER,
    height INTEGER,
    duration_seconds REAL,
    thumbnail_id INTEGER,
    thumbnail_crop TEXT,
    UNIQUE (parent_path, item_name)
);

INSERT INTO item_reshaped (id, parent_path, item_name, item_type, media_type, title, description, tags, version_id,
    published, updated_on, width, height, duration_seconds, thumbnail_id, thumbnail_crop)
SELECT id, parent_path, item_name,
    CASE WHEN item_type = 'album' THEN 'album' ELSE 'media' END,
    CASE WHEN item_type = 'album' THEN NULL ELSE item_type END,
    title, description, tags, version_id, published, updated_on, width, height, duration_seconds, thumbnail_id,
    thumbnail_crop
FROM item;

DROP TABLE item;

ALTER TABLE item_reshaped RENAME TO item;
