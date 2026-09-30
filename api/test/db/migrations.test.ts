import { type D1Migration, applyD1Migrations, reset } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { orm, schema } from '../../src/db';
import { ftsQuery } from '../../src/gallery/query';
import { searchItems } from '../../src/gallery/search';

// A database that has been in use is migrated forward with rows in every table, so these start that way: apply the
// migrations one by one, writing rows at the points below until every column holds a value, then apply the rest and
// check that nothing was lost. A rebuild of item that forgets to carry the foreign-key links across, or to put the
// search view and triggers back, fails here.

/**
 * Rows written once the named migration has run, in the shape the tables had then, since a migration never changes.
 * The first set is the baseline of 2026-09-30, with every foreign key pointing somewhere; a later set fills a column
 * a later migration adds, so that a rebuild has something to lose in every column.
 */
const FIXTURES: Record<string, string[]> = {
    '20260930020905_seed_users.sql': [
        `INSERT INTO item (id, parent_path, item_name, item_type) VALUES (1, '/', '2001', 'album')`,
        `INSERT INTO item (id, parent_path, item_name, item_type) VALUES (2, '/2001/', '06-15', 'album')`,
        `INSERT INTO item (id, parent_path, item_name, item_type, media_type, version_id, width, height, title, description, tags, thumbnail_crop) VALUES (3, '/2001/06-15/', 'felix', 'media', 'image', '01ARYZ6S41TSV4RRFFQ69G5FAV', 4032, 3024, 'Quesadilla', 'Lunch', '["food"]', '{"x":0,"y":0,"width":100,"height":100}')`,
        `INSERT INTO item (id, parent_path, item_name, item_type, media_type, version_id, width, height, duration_seconds) VALUES (4, '/2001/06-15/', 'clip', 'media', 'video', '01ARYZ6S41TSV4RRFFQ69G5FA4', 1920, 1080, 9.5)`,
        `UPDATE item SET thumbnail_id = 3 WHERE id IN (1, 2)`,
        `UPDATE item SET position = 0 WHERE id = 3`,
        `UPDATE item SET summary = 'A day out', published = 1 WHERE id = 2`,
        `INSERT INTO upload (version_id, parent_path, item_name, album_id, replacement, target_id, username, completed_at) VALUES ('01ARYZ6S41TSV4RRFFQ69G5FA2', '/2001/06-15/', 'felix', 2, 1, 3, 'moses', '2026-09-27T00:00:00.000Z')`,
        `INSERT INTO upload_error (path, message) VALUES ('/2001/06-15/broken', 'Not an image')`,
        `INSERT INTO passkey (credential_id, username, public_key, transports, last_used_at) VALUES ('credential', 'moses', 'key', '["internal"]', '2026-09-27T00:00:00.000Z')`,
        `INSERT INTO invite (token_hash, username, expires_at, used_at) VALUES ('${'a'.repeat(64)}', 'moses', '2999-01-01T00:00:00.000Z', '2026-09-27T00:00:00.000Z')`,
        `INSERT INTO spent_challenge (challenge, expires_at) VALUES ('challenge', '2999-01-01T00:00:00.000Z')`,
    ],
};

/** Applies the migrations through the last one with a fixture, writing each fixture in turn; returns the rest. */
async function migratedToFixtures(): Promise<D1Migration[]> {
    const names = env.TEST_MIGRATIONS.map((migration) => migration.name);
    for (const name of Object.keys(FIXTURES)) {
        if (!names.includes(name)) throw new Error(`No migration named ${name}`);
    }
    const last = Math.max(...Object.keys(FIXTURES).map((name) => names.indexOf(name)));
    await reset();
    for (const migration of env.TEST_MIGRATIONS.slice(0, last + 1)) {
        await applyD1Migrations(env.DB, [migration]);
        const fixture = FIXTURES[migration.name] ?? [];
        if (fixture.length > 0) {
            await env.DB.batch(fixture.map((statement) => env.DB.prepare(statement)));
        }
    }
    return env.TEST_MIGRATIONS.slice(last + 1);
}

/** The tables that hold the gallery's data: not SQLite's own, not D1's, and not the FTS5 index's shadow tables. */
async function tables(): Promise<string[]> {
    const rows = await env.DB.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' AND name NOT LIKE 'item_fts%' ORDER BY name`,
    ).all<{ name: string }>();
    return rows.results.map((row) => row.name);
}

/** How many rows hold a value in each column, as `table.column`. */
async function valuesHeld(): Promise<Map<string, number>> {
    const held = new Map<string, number>();
    for (const table of await tables()) {
        const columns = await env.DB.prepare(`PRAGMA table_info("${table}")`).all<{ name: string }>();
        const counts = columns.results.map((column) => `count("${column.name}") AS "${column.name}"`).join(', ');
        const row = await env.DB.prepare(`SELECT ${counts} FROM "${table}"`).first<Record<string, number>>();
        for (const [column, count] of Object.entries(row ?? {})) {
            held.set(`${table}.${column}`, count);
        }
    }
    return held;
}

async function found(terms: string): Promise<string[]> {
    const compiled = ftsQuery(terms);
    if ('error' in compiled) throw new Error(compiled.error);
    const result = await searchItems(
        orm(env.DB),
        { query: compiled.query, oldestFirst: false, startAt: 0, pageSize: 50 },
        true,
    );
    return result.items.map((item) => item.path);
}

describe('migrating a database in use', () => {
    let rest: D1Migration[];
    let before: Map<string, number>;

    beforeEach(async () => {
        rest = await migratedToFixtures();
        before = await valuesHeld();
    });

    it('fills every column before migrating, so a rebuild has something to lose in each', async () => {
        await applyD1Migrations(env.DB, rest);

        const unfilled = [...(await valuesHeld()).keys()].filter((key) => (before.get(key) ?? 0) === 0);

        expect(unfilled).toStrictEqual([]);
    });

    it('keeps every value: no column holds fewer afterwards', async () => {
        await applyD1Migrations(env.DB, rest);

        const after = await valuesHeld();
        const lost = [...before].filter(([key, count]) => after.has(key) && (after.get(key) ?? 0) < count);

        expect(lost).toStrictEqual([]);
        await expect(env.DB.prepare('PRAGMA foreign_key_check').all()).resolves.toMatchObject({ results: [] });
    });

    it('keeps the links a rebuild of item clears', async () => {
        await applyD1Migrations(env.DB, rest);

        const database = orm(env.DB);
        const { item, upload } = schema;
        const albums = await database
            .select({ id: item.id, thumbnailId: item.thumbnailId })
            .from(item)
            .where(eq(item.itemType, 'album'))
            .orderBy(item.id);

        expect(albums).toStrictEqual([
            { id: 1, thumbnailId: 3 },
            { id: 2, thumbnailId: 3 },
        ]);
        await expect(
            database.select({ albumId: upload.albumId, targetId: upload.targetId }).from(upload),
        ).resolves.toStrictEqual([{ albumId: 2, targetId: 3 }]);
    });

    it('keeps the search index and the triggers that maintain it', async () => {
        await applyD1Migrations(env.DB, rest);

        await env.DB.prepare(
            `INSERT INTO item (parent_path, item_name, item_type, media_type, version_id, width, height, title) VALUES ('/2001/06-15/', 'milo', 'media', 'image', '01ARYZ6S41TSV4RRFFQ69G5FA3', 4032, 3024, 'Taco')`,
        ).run();

        await expect(found('quesadilla')).resolves.toStrictEqual(['/2001/06-15/felix']);
        await expect(found('taco')).resolves.toStrictEqual(['/2001/06-15/milo']);
    });

    it('leaves the search index as src/db/search-index.sql makes it, so a rebuild can copy the file', async () => {
        await applyD1Migrations(env.DB, rest);
        const objects = env.DB.prepare(
            `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`,
        );
        const wanted = (await objects.all()).results;
        const statements = env.SEARCH_INDEX.flatMap((file) => file.queries);

        await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));

        await expect(objects.all()).resolves.toMatchObject({ results: wanted });
        await expect(found('quesadilla')).resolves.toStrictEqual(['/2001/06-15/felix']);
    });
});
