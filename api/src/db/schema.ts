import { sql } from 'drizzle-orm';
import {
    type AnySQLiteColumn,
    check,
    index,
    integer,
    real,
    sqliteTable,
    text,
    unique,
    uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import {
    type Rectangle,
    dayAlbumKeySql,
    dayAlbumPathSql,
    itemTypeSchema,
    mediaNameSql,
    mediaPathSql,
    mediaTypeSchema,
    versionIdSql,
    yearNameSql,
} from '@tacocat-gallery/shared';

// The FTS5 table `item_fts` and the triggers that keep it in sync with `item` are raw SQL in migrations/, because
// Drizzle does not model virtual tables or triggers. drizzle-kit leaves them alone.
//
// Every rule about a single row is a constraint here, so that no code path can write a row the rules forbid. A
// constraint failing is a bug and answers 500; a rule with a user-facing answer is checked in gallery/ first.

/**
 * As SQL literals for the check constraints. A new item or media type changes a constraint, which needs a migration.
 */
const ITEM_TYPES_SQL = sqlList(itemTypeSchema.options);
const MEDIA_TYPES_SQL = sqlList(mediaTypeSchema.options);

function sqlList(values: readonly string[]): string {
    return values.map((value) => `'${value}'`).join(', ');
}

/** SQLite's clock in the format `created_at` and `updated_at` hold: `2001-06-15T12:34:56.789Z`. */
export const NOW = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

// The path and name rules are the SQL forms of the ones in shared/, written by hand beside them, and a test holds each
// pair to the same answers. A check whose expression comes out NULL passes, so every rule below says what it needs to
// be non-null.

/**
 * `column` is a timestamp in the one format the defaults write, or, when `nullable`, null. SQLite reads the text as a
 * date and writes it out again in that format, so only a real date spelled exactly that way comes back unchanged;
 * `IS` rather than `=` so that text SQLite cannot read as a date, which comes back as null, fails.
 */
function timestampSql(column: string, { nullable = false } = {}): string {
    return `${nullable ? `${column} IS NULL OR ` : ''}strftime('%Y-%m-%dT%H:%M:%fZ', ${column}) IS ${column}`;
}

/** `column` is text with something in it once spaces, tabs and line breaks are trimmed, or null. */
function captionSql(column: string): string {
    return `${column} IS NULL OR trim(${column}, char(32, 9, 10, 13)) <> ''`;
}

/** `column` is JSON holding a number at `path`. */
function jsonNumberSql(column: string, path: string): string {
    return `coalesce(json_type(${column}, '${path}'), '') IN ('integer', 'real')`;
}

/**
 * When each row was made and last changed. Both come from SQLite's clock, so a row created and updated in one batch
 * cannot end up changed before it was made: a JavaScript date would be taken when the statement is built, before the
 * batch runs. Drizzle's update builder sets `updated_at` on its own; an upsert sets it in its conflict clause.
 */
const timestamps = {
    createdAt: text('created_at').notNull().default(NOW),
    updatedAt: text('updated_at')
        .notNull()
        .default(NOW)
        .$onUpdate(() => NOW),
};

/** The constraints every table's timestamps meet, named after the table since a check's name is per database. */
function timestampChecks(table: string): ReturnType<typeof check>[] {
    return [
        check(`${table}_created_at_format`, sql.raw(timestampSql('created_at'))),
        check(`${table}_updated_at_format`, sql.raw(timestampSql('updated_at'))),
        check(`${table}_updated_after_created`, sql.raw('updated_at >= created_at')),
    ];
}

/** Gallery items: albums, photos and videos. */
export const item = sqliteTable(
    'item',
    {
        /** Integer rowid; the FTS index and `thumbnail_id` key on it. */
        id: integer('id').primaryKey(),
        parentPath: text('parent_path').notNull(),
        itemName: text('item_name').notNull(),
        itemType: text('item_type', { enum: itemTypeSchema.options }).notNull(),
        /** Which kind of media a media item is; null for an album. */
        mediaType: text('media_type', { enum: mediaTypeSchema.options }),
        title: text('title'),
        description: text('description'),
        /** An album's caption on its thumbnail, a line long; its date is its title. */
        summary: text('summary'),
        /** A JSON array, so no delimiter can collide with a keyword; FTS5 reads the words out of the JSON text. */
        tags: text('tags', { mode: 'json' }).$type<string[]>(),
        /** Which upload of a media item is current; its original is stored under this id. Null for an album. */
        versionId: text('version_id'),
        /** Guests see published albums; media shows whenever its album does, so it is never published itself. */
        published: integer('published', { mode: 'boolean' }).notNull().default(false),
        /** In the EXIF-oriented frame, the frame every crop is in. */
        width: integer('width'),
        height: integer('height'),
        durationSeconds: real('duration_seconds'),
        /**
         * The media item an album shows as its thumbnail, by row id so a rename of the media does not lose it, and
         * cleared by the database when that media is deleted.
         */
        thumbnailId: integer('thumbnail_id').references((): AnySQLiteColumn => item.id, { onDelete: 'set null' }),
        /** The rectangle of a media item, in its EXIF-oriented pixels, that its thumbnail is cut from. */
        thumbnailCrop: text('thumbnail_crop', { mode: 'json' }).$type<Rectangle>(),
        /**
         * Where an admin placed a media item in its album. An album sorts by name until an admin reorders it; media
         * added after that has none and follows the placed media, in name order.
         */
        position: integer('position'),
        ...timestamps,
    },
    (table) => [
        unique().on(table.parentPath, table.itemName),
        // An object's row is one lookup, and clearing a deleted thumbnail from the albums that show it is a seek.
        index('item_version_id').on(table.versionId),
        index('item_thumbnail_id').on(table.thumbnailId),
        // No two media items of an album in one place.
        uniqueIndex('item_album_position')
            .on(table.parentPath, table.position)
            .where(sql`position IS NOT NULL`),
        check('item_type_check', sql.raw(`item_type IN (${ITEM_TYPES_SQL})`)),
        // Every media item says which kind it is, and an album says nothing.
        check(
            'item_media_type_check',
            sql.raw(
                `(item_type = 'media') = (media_type IS NOT NULL) AND (media_type IS NULL OR media_type IN (${MEDIA_TYPES_SQL}))`,
            ),
        ),
        // The URL scheme: a year album in the root, a day album in a year, on its calendar, a media item in a day.
        check(
            'item_path_check',
            sql.raw(
                `CASE item_type WHEN 'album' THEN (parent_path = '/' AND ${yearNameSql('item_name')}) OR (${dayAlbumKeySql('parent_path', 'item_name')}) ELSE ${dayAlbumPathSql('parent_path')} AND ${mediaNameSql('item_name')} END`,
            ),
        ),
        // A media item comes with its file and its size, and an album with neither.
        check(
            'item_file_check',
            sql.raw(
                `CASE item_type WHEN 'album' THEN version_id IS NULL AND width IS NULL AND height IS NULL ELSE ${versionIdSql('version_id')} AND coalesce(width, 0) > 0 AND coalesce(height, 0) > 0 END`,
            ),
        ),
        check(
            'item_duration_check',
            sql.raw(
                `(media_type IS 'video') = (duration_seconds IS NOT NULL) AND (duration_seconds IS NULL OR duration_seconds > 0)`,
            ),
        ),
        // Captions belong to one type, and a caption that is present is not blank.
        check(
            'item_caption_check',
            sql.raw(
                `CASE item_type WHEN 'album' THEN title IS NULL AND tags IS NULL ELSE summary IS NULL END AND (${captionSql('title')}) AND (${captionSql('description')}) AND (${captionSql('summary')})`,
            ),
        ),
        check(
            'item_tags_check',
            sql.raw(`tags IS NULL OR (json_valid(tags) AND json_type(tags) = 'array' AND json_array_length(tags) > 0)`),
        ),
        check('item_published_check', sql.raw(`published IN (0, 1) AND (item_type = 'album' OR published = 0)`)),
        // Only media is placed, at a whole number from zero; SQLite would keep 1.5 in an integer column.
        check(
            'item_position_check',
            sql.raw(`position IS NULL OR (item_type = 'media' AND typeof(position) = 'integer' AND position >= 0)`),
        ),
        // An album points at its thumbnail; a media item's crop is a rectangle inside its own frame.
        check(
            'item_thumbnail_check',
            sql.raw(
                `CASE item_type WHEN 'album' THEN thumbnail_crop IS NULL ELSE thumbnail_id IS NULL AND (thumbnail_crop IS NULL OR (json_valid(thumbnail_crop) AND json_type(thumbnail_crop) = 'object' AND ${['$.x', '$.y', '$.width', '$.height'].map((side) => jsonNumberSql('thumbnail_crop', side)).join(' AND ')} AND json_extract(thumbnail_crop, '$.x') >= 0 AND json_extract(thumbnail_crop, '$.y') >= 0 AND json_extract(thumbnail_crop, '$.width') > 0 AND json_extract(thumbnail_crop, '$.height') > 0 AND json_extract(thumbnail_crop, '$.x') + json_extract(thumbnail_crop, '$.width') <= coalesce(width, 0) AND json_extract(thumbnail_crop, '$.y') + json_extract(thumbnail_crop, '$.height') <= coalesce(height, 0))) END`,
            ),
        ),
        ...timestampChecks('item'),
    ],
);

/**
 * Who may log in. There is no screen for this table: a migration seeds it, and a new user is another migration, so the
 * list of users is code and a pull request is its history.
 */
export const user = sqliteTable(
    'user',
    {
        /** The lowercase handle, which is what the session cookie carries and what other tables key on. */
        username: text('username').primaryKey(),
        ...timestamps,
    },
    () => [
        check('user_username_format', sql.raw(`username GLOB '[a-z]*' AND username NOT GLOB '*[^a-z0-9_]*'`)),
        ...timestampChecks('user'),
    ],
);

/**
 * Every version id the Worker mints, one row per presigned URL: what the upload is for, who asked, and whether the
 * pipeline has made it an item. Completed rows stay as the record of who uploaded what and when; rows that never
 * complete leave with their inbox objects in the purge.
 */
export const upload = sqliteTable(
    'upload',
    {
        versionId: text('version_id').primaryKey(),
        /**
         * The day album and name asked for when the URL was issued. The pipeline places the item by `album_id`, under
         * the album's path as it is then, so these are the record of the request; a replacement keeps its target's
         * name, whatever it is by then.
         */
        parentPath: text('parent_path').notNull(),
        itemName: text('item_name').notNull(),
        /** The day album the item goes in, by row id, cleared by the database if the album is deleted first. */
        albumId: integer('album_id').references(() => item.id, { onDelete: 'set null' }),
        /**
         * Whether the upload replaces the item at its path, and that item by row id, which the database clears if it
         * is deleted before the upload finishes; the flag then still says the upload was a replacement.
         */
        replacement: integer('replacement', { mode: 'boolean' }).notNull().default(false),
        targetId: integer('target_id').references(() => item.id, { onDelete: 'set null' }),
        username: text('username')
            .notNull()
            .references(() => user.username),
        completedAt: text('completed_at'),
        ...timestamps,
    },
    (table) => [
        // Clearing a deleted album or item from the uploads that point at it is a seek, not a scan of every upload.
        index('upload_album_id').on(table.albumId),
        index('upload_target_id').on(table.targetId),
        check('upload_version_id_format', sql.raw(versionIdSql('version_id'))),
        check('upload_path_check', sql.raw(`${dayAlbumPathSql('parent_path')} AND ${mediaNameSql('item_name')}`)),
        check('upload_target_check', sql.raw(`replacement IN (0, 1) AND (replacement = 1 OR target_id IS NULL)`)),
        check('upload_completed_at_format', sql.raw(timestampSql('completed_at', { nullable: true }))),
        ...timestampChecks('upload'),
    ],
);

/** Why uploads could not be processed, the latest per path. Rows are purged after a day; the log has the rest. */
export const uploadError = sqliteTable(
    'upload_error',
    {
        path: text('path').primaryKey(),
        message: text('message').notNull(),
        ...timestamps,
    },
    () => [
        check('upload_error_path_check', sql.raw(mediaPathSql('path'))),
        check('upload_error_message_check', sql.raw(`trim(message, char(32, 9, 10, 13)) <> ''`)),
        ...timestampChecks('upload_error'),
    ],
);

/** Passkeys. A user has one per password manager or device they registered. */
export const passkey = sqliteTable(
    'passkey',
    {
        credentialId: text('credential_id').primaryKey(),
        username: text('username')
            .notNull()
            .references(() => user.username),
        /** Checks the signature a login sends. */
        publicKey: text('public_key').notNull(),
        /** The authenticator's sign count, which only rises, so a lower one gives away a cloned key. */
        counter: integer('counter').notNull().default(0),
        /** Where the browser can reach the passkey (internal, usb, nfc, hybrid…), passed back so it looks there first. */
        transports: text('transports', { mode: 'json' }).$type<string[]>(),
        lastUsedAt: text('last_used_at'),
        ...timestamps,
    },
    () => [
        check('passkey_credential_id_check', sql.raw(`credential_id <> ''`)),
        check('passkey_public_key_check', sql.raw(`public_key <> ''`)),
        check('passkey_counter_check', sql.raw(`counter >= 0`)),
        check('passkey_last_used_at_format', sql.raw(timestampSql('last_used_at', { nullable: true }))),
        ...timestampChecks('passkey'),
    ],
);

/**
 * One-time links that let whoever opens them register a passkey as `username`. Only the hash of each token is stored;
 * the token itself is in the link.
 */
export const invite = sqliteTable(
    'invite',
    {
        tokenHash: text('token_hash').primaryKey(),
        username: text('username')
            .notNull()
            .references(() => user.username),
        expiresAt: text('expires_at').notNull(),
        usedAt: text('used_at'),
        ...timestamps,
    },
    () => [
        // SHA-256 as lowercase hex.
        check('invite_token_hash_format', sql.raw(`length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'`)),
        check('invite_expires_at_format', sql.raw(timestampSql('expires_at'))),
        check('invite_used_at_format', sql.raw(timestampSql('used_at', { nullable: true }))),
        ...timestampChecks('invite'),
    ],
);

/**
 * Login challenges that have already let someone in, kept until their cookies expire so the same answer cannot be sent
 * again. Synced passkeys report a sign count of 0 on every use, so the count cannot catch a replay.
 */
export const spentChallenge = sqliteTable(
    'spent_challenge',
    {
        challenge: text('challenge').primaryKey(),
        expiresAt: text('expires_at').notNull(),
        ...timestamps,
    },
    (table) => [
        // The nightly purge reads only what it deletes.
        index('spent_challenge_expires_at').on(table.expiresAt),
        check('spent_challenge_expires_at_format', sql.raw(timestampSql('expires_at'))),
        ...timestampChecks('spent_challenge'),
    ],
);

export type Item = typeof item.$inferSelect;
export type NewItem = typeof item.$inferInsert;
