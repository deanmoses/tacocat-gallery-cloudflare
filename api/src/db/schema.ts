import { sql } from 'drizzle-orm';
import { check, index, integer, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import type { Rectangle } from 'tacocat-gallery-shared';

// The FTS5 table `item_fts` and the triggers that keep it in sync with `item` are raw SQL in migrations/, because
// Drizzle does not model virtual tables or triggers. drizzle-kit leaves them alone.

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const item = sqliteTable(
    'item',
    {
        // Integer rowid so the FTS index can key on it.
        id: integer('id').primaryKey(),
        parentPath: text('parent_path').notNull(),
        itemName: text('item_name').notNull(),
        itemType: text('item_type', { enum: ['album', 'image', 'video'] }).notNull(),
        title: text('title'),
        description: text('description'),
        tags: text('tags'),
        versionId: text('version_id'),
        published: integer('published', { mode: 'boolean' }).notNull().default(false),
        updatedOn: text('updated_on').notNull().default(now),
        width: integer('width'),
        height: integer('height'),
        durationSeconds: real('duration_seconds'),
        // The media item an album shows as its thumbnail, by row id so a rename of the media does not lose it.
        thumbnailId: integer('thumbnail_id'),
        // The rectangle of a media item, in its EXIF-oriented pixels, that its thumbnail is cut from.
        thumbnailCrop: text('thumbnail_crop', { mode: 'json' }).$type<Rectangle>(),
    },
    (table) => [
        unique().on(table.parentPath, table.itemName),
        check('item_type_check', sql`${table.itemType} IN ('album', 'image', 'video')`),
    ],
);

export const probeResult = sqliteTable(
    'probe_result',
    {
        id: integer('id').primaryKey(),
        runAt: text('run_at').notNull(),
        idleHours: real('idle_hours'),
        location: text('location').notNull(),
        seq: integer('seq').notNull(),
        path: text('path').notNull(),
        probeCity: text('probe_city'),
        probeNetwork: text('probe_network'),
        status: integer('status'),
        totalMs: integer('total_ms'),
        dnsMs: integer('dns_ms'),
        tcpMs: integer('tcp_ms'),
        tlsMs: integer('tls_ms'),
        firstByteMs: integer('first_byte_ms'),
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

// What an admin sees when an upload could not be processed. Rows are purged after a day; the log has the rest.
export const uploadError = sqliteTable('upload_error', {
    path: text('path').primaryKey(),
    message: text('message').notNull(),
    createdAt: text('created_at').notNull().default(now),
});

export const adminPasskey = sqliteTable('admin_passkey', {
    credentialId: text('credential_id').primaryKey(),
    adminName: text('admin_name').notNull(),
    publicKey: text('public_key').notNull(),
    counter: integer('counter').notNull().default(0),
    transports: text('transports', { mode: 'json' }).$type<string[]>(),
    createdAt: text('created_at').notNull().default(now),
    lastUsedAt: text('last_used_at'),
});

// Only the hash of an invite token is stored; the token itself is in the link.
export const adminInvite = sqliteTable('admin_invite', {
    tokenHash: text('token_hash').primaryKey(),
    adminName: text('admin_name').notNull(),
    expiresAt: text('expires_at').notNull(),
    usedAt: text('used_at'),
});

export type Item = typeof item.$inferSelect;
export type NewItem = typeof item.$inferInsert;
