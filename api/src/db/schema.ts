import { sql } from 'drizzle-orm';
import { check, index, integer, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { type Rectangle, itemTypeSchema, mediaTypeSchema } from 'tacocat-gallery-shared';

// The FTS5 table `item_fts` and the triggers that keep it in sync with `item` are raw SQL in migrations/, because
// Drizzle does not model virtual tables or triggers. drizzle-kit leaves them alone.

/**
 * As SQL literals for the check constraints. A new item or media type changes a constraint, which needs a migration.
 */
const ITEM_TYPES_SQL = sqlList(itemTypeSchema.options);
const MEDIA_TYPES_SQL = sqlList(mediaTypeSchema.options);

function sqlList(values: readonly string[]): string {
    return values.map((value) => `'${value}'`).join(', ');
}

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

/** Gallery items: albums, photos and videos. */
export const item = sqliteTable(
    'item',
    {
        /** Integer rowid so the FTS index can key on it. */
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
        /** Comma-separated. */
        tags: text('tags'),
        /** Which upload of a media item is current; its original is stored under this id. Null for an album. */
        versionId: text('version_id'),
        published: integer('published', { mode: 'boolean' }).notNull().default(false),
        updatedOn: text('updated_on').notNull().default(now),
        width: integer('width'),
        height: integer('height'),
        durationSeconds: real('duration_seconds'),
        /** The media item an album shows as its thumbnail, by row id so a rename of the media does not lose it. */
        thumbnailId: integer('thumbnail_id'),
        /** The rectangle of a media item, in its EXIF-oriented pixels, that its thumbnail is cut from. */
        thumbnailCrop: text('thumbnail_crop', { mode: 'json' }).$type<Rectangle>(),
    },
    (table) => [
        unique().on(table.parentPath, table.itemName),
        check('item_type_check', sql`${table.itemType} IN (${sql.raw(ITEM_TYPES_SQL)})`),
        // Every media item says which kind it is, and an album says nothing.
        check(
            'media_type_check',
            sql`(${table.itemType} = 'media') = (${table.mediaType} IS NOT NULL) AND (${table.mediaType} IS NULL OR ${table.mediaType} IN (${sql.raw(MEDIA_TYPES_SQL)}))`,
        ),
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
    },
    (table) => [index('probe_result_run_at').on(table.runAt)],
);

/** Why uploads could not be processed, the latest per path. Rows are purged after a day; the log has the rest. */
export const uploadError = sqliteTable('upload_error', {
    path: text('path').primaryKey(),
    message: text('message').notNull(),
    createdAt: text('created_at').notNull().default(now),
});

/**
 * Who may log in. There is no screen for this table: a migration seeds it, and a new user is another migration, so the
 * list of users is code and a pull request is its history.
 */
export const user = sqliteTable('user', {
    /** The lowercase handle, which is what the session cookie carries and what other tables key on. */
    username: text('username').primaryKey(),
    createdAt: text('created_at').notNull().default(now),
});

/** Passkeys. A user has one per password manager or device they registered. */
export const passkey = sqliteTable('passkey', {
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
    createdAt: text('created_at').notNull().default(now),
    lastUsedAt: text('last_used_at'),
});

/**
 * One-time links that let whoever opens them register a passkey as `username`. Only the hash of each token is stored;
 * the token itself is in the link.
 */
export const invite = sqliteTable('invite', {
    tokenHash: text('token_hash').primaryKey(),
    username: text('username')
        .notNull()
        .references(() => user.username),
    expiresAt: text('expires_at').notNull(),
    usedAt: text('used_at'),
});

/**
 * Login challenges that have already let someone in, kept until their cookies expire so the same answer cannot be sent
 * again. Synced passkeys report a sign count of 0 on every use, so the count cannot catch a replay.
 */
export const spentChallenge = sqliteTable(
    'spent_challenge',
    {
        challenge: text('challenge').primaryKey(),
        expiresAt: text('expires_at').notNull(),
    },
    // The nightly purge reads only what it deletes.
    (table) => [index('spent_challenge_expires_at').on(table.expiresAt)],
);

export type Item = typeof item.$inferSelect;
export type NewItem = typeof item.$inferInsert;
