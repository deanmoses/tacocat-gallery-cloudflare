import { sql } from 'drizzle-orm';
import { type AnySQLiteColumn, check, index, integer, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { type Rectangle, itemTypeSchema, mediaTypeSchema } from 'tacocat-gallery-shared';

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

// GLOB patterns, which have character classes but no repetition, so a fixed-width format is spelled out. D1 refuses
// a pattern longer than 50 characters, so a longer format is checked in pieces.
const YEAR_GLOB = '[0-9][0-9][0-9][0-9]';
const DAY_GLOB = '[0-9][0-9]-[0-9][0-9]';
const DAY_ALBUM_PATH_GLOB = `/${YEAR_GLOB}/${DAY_GLOB}/`;
const DAY_ALBUM_PATH_LENGTH = '/2001/06-15/'.length;

// A check whose expression comes out NULL passes, so every rule below says what it needs to be non-null.

/**
 * `column` is a timestamp in the one format the defaults write, or, when `nullable`, null. SQLite reads the text as a
 * date and writes it out again in that format, so only a real date spelled exactly that way comes back unchanged;
 * `IS` rather than `=` so that text SQLite cannot read as a date, which comes back as null, fails.
 */
function timestampSql(column: string, { nullable = false } = {}): string {
    return `${nullable ? `${column} IS NULL OR ` : ''}strftime('%Y-%m-%dT%H:%M:%fZ', ${column}) IS ${column}`;
}

/**
 * `column` is a media file name: one dot with something on each side, no slash, and not `.jpeg`, since the gallery
 * stores a JPEG as `.jpg` and the sanitizer spells it so before the name reaches a table.
 */
function mediaNameSql(column: string): string {
    return `${column} GLOB '?*.?*' AND ${column} NOT GLOB '*.*.*' AND ${column} NOT GLOB '*/*' AND lower(${column}) NOT GLOB '*.jpeg'`;
}

/** `column` is the path of a media item in a day album: `/2001/06-15/felix.jpg`. */
function mediaPathSql(column: string): string {
    return `${column} IS NOT NULL AND substr(${column}, 1, ${DAY_ALBUM_PATH_LENGTH}) GLOB '${DAY_ALBUM_PATH_GLOB}' AND ${mediaNameSql(`substr(${column}, ${DAY_ALBUM_PATH_LENGTH + 1})`)}`;
}

/** `column` is a version id: letters, digits, dot, underscore and hyphen, which admits the ids AWS assigned too. */
function versionIdSql(column: string): string {
    return `${column} IS NOT NULL AND ${column} <> '' AND ${column} NOT GLOB '*[^A-Za-z0-9._-]*'`;
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
        ...timestamps,
    },
    (table) => [
        unique().on(table.parentPath, table.itemName),
        // An object's row is one lookup, and clearing a deleted thumbnail from the albums that show it is a seek.
        index('item_version_id').on(table.versionId),
        index('item_thumbnail_id').on(table.thumbnailId),
        check('item_type_check', sql.raw(`item_type IN (${ITEM_TYPES_SQL})`)),
        // Every media item says which kind it is, and an album says nothing.
        check(
            'item_media_type_check',
            sql.raw(
                `(item_type = 'media') = (media_type IS NOT NULL) AND (media_type IS NULL OR media_type IN (${MEDIA_TYPES_SQL}))`,
            ),
        ),
        // The URL scheme: a year album in the root, a day album in a year, a media file in a day.
        check(
            'item_path_check',
            sql.raw(
                `CASE item_type WHEN 'album' THEN (parent_path = '/' AND item_name GLOB '${YEAR_GLOB}') OR (parent_path GLOB '/${YEAR_GLOB}/' AND item_name GLOB '${DAY_GLOB}') ELSE parent_path GLOB '${DAY_ALBUM_PATH_GLOB}' AND ${mediaNameSql('item_name')} END`,
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
         * the album's path as it is then, so these are the record of the request; a replacement takes only the
         * extension of `item_name`, keeping the target's own base name.
         */
        parentPath: text('parent_path').notNull(),
        itemName: text('item_name').notNull(),
        /** The day album the item goes in, by row id, cleared by the database if the album is deleted first. */
        albumId: integer('album_id').references(() => item.id, { onDelete: 'set null' }),
        /**
         * The item a replacement replaces, by row id and by path. The id is cleared by the database if that item is
         * deleted before the upload finishes, and the path then still says the upload was a replacement.
         */
        targetId: integer('target_id').references(() => item.id, { onDelete: 'set null' }),
        targetPath: text('target_path'),
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
        check(
            'upload_path_check',
            sql.raw(`parent_path GLOB '${DAY_ALBUM_PATH_GLOB}' AND ${mediaNameSql('item_name')}`),
        ),
        check(
            'upload_target_check',
            sql.raw(`(target_path IS NULL AND target_id IS NULL) OR ${mediaPathSql('target_path')}`),
        ),
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

/**
 * Timed requests from the scheduled idle-latency probes: Globalping probes in readers' regions fetching the site after
 * it has been left alone, to measure what a reader's first request costs. Performance research, not site data.
 */
export const probeResult = sqliteTable(
    'probe_result',
    {
        id: integer('id').primaryKey(),
        runAt: text('run_at').notNull(),
        /** Hours since the previous run, which is how long the Worker and D1 had been idle; null on the first run. */
        idleHours: real('idle_hours'),
        location: text('location').notNull(),
        /** Position in the location's sequence of requests; 0 is the one that finds everything idle. */
        seq: integer('seq').notNull(),
        path: text('path').notNull(),
        probeCity: text('probe_city'),
        probeNetwork: text('probe_network'),
        // The HTTP status and timings as Globalping measured them from the probe.
        status: integer('status'),
        totalMs: integer('total_ms'),
        dnsMs: integer('dns_ms'),
        tcpMs: integer('tcp_ms'),
        tlsMs: integer('tls_ms'),
        firstByteMs: integer('first_byte_ms'),
        // What the Worker reported about itself in its response headers: where it and D1 ran, and for how long.
        workerColo: text('worker_colo'),
        workerMs: real('worker_ms'),
        d1Region: text('d1_region'),
        d1Colo: text('d1_colo'),
        d1Primary: text('d1_primary'),
        d1RttMs: real('d1_rtt_ms'),
        measurementId: text('measurement_id'),
        error: text('error'),
        ...timestamps,
    },
    (table) => [
        index('probe_result_run_at').on(table.runAt),
        check('probe_result_seq_check', sql.raw(`seq >= 0`)),
        check('probe_result_status_check', sql.raw(`status IS NULL OR status BETWEEN 100 AND 599`)),
        check(
            'probe_result_timings_check',
            sql.raw(
                `(total_ms IS NULL OR total_ms >= 0) AND (dns_ms IS NULL OR dns_ms >= 0) AND (tcp_ms IS NULL OR tcp_ms >= 0) AND (tls_ms IS NULL OR tls_ms >= 0) AND (first_byte_ms IS NULL OR first_byte_ms >= 0) AND (worker_ms IS NULL OR worker_ms >= 0) AND (d1_rtt_ms IS NULL OR d1_rtt_ms >= 0)`,
            ),
        ),
        ...timestampChecks('probe_result'),
    ],
);

export type Item = typeof item.$inferSelect;
export type NewItem = typeof item.$inferInsert;
