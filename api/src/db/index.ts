import { sql } from 'drizzle-orm';
import { type DrizzleD1Database, drizzle } from 'drizzle-orm/d1';
import type { SQLiteInsertBase } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

/** Drizzle over D1 or over a Sessions API session. */
export function orm(d1: D1Database | D1DatabaseSession): Orm {
    // Only a session has getBookmark(); neither class exists at runtime to test with instanceof.
    return drizzle('getBookmark' in d1 ? sessionAsDatabase(d1) : d1, { schema });
}

/**
 * Drizzle's types name D1Database, but it only calls prepare() and batch(), which a session has too. The rest of
 * D1Database throws, so a Drizzle upgrade that starts using it fails loudly.
 */
function sessionAsDatabase(session: D1DatabaseSession): D1Database {
    return {
        prepare: (query) => session.prepare(query),
        batch: async (statements) => session.batch(statements),
        exec: unsupported('exec'),
        withSession: unsupported('withSession'),
        dump: unsupported('dump'),
    };
}

function unsupported(method: string): () => never {
    return () => {
        throw new Error(`D1DatabaseSession has no ${method}()`);
    };
}

export type Orm = DrizzleD1Database<typeof schema>;

/** An item upsert, ready to run, await or batch. */
export type ItemUpsert = SQLiteInsertBase<typeof schema.item, 'async', D1Result>;

/** Inserts or replaces an item's fields by path; a field left out of `values` is cleared on update. */
export function upsertItem(database: Orm, values: schema.NewItem): ItemUpsert {
    const { item } = schema;
    return database
        .insert(item)
        .values(values)
        .onConflictDoUpdate({
            target: [item.parentPath, item.itemName],
            set: {
                title: sql`excluded.title`,
                description: sql`excluded.description`,
                tags: sql`excluded.tags`,
                versionId: sql`excluded.version_id`,
                published: sql`excluded.published`,
                width: sql`excluded.width`,
                height: sql`excluded.height`,
                durationSeconds: sql`excluded.duration_seconds`,
                updatedOn: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
            },
        });
}

export * as schema from './schema';
