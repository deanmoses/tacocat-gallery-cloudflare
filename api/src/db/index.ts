import { getTableColumns, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { type DrizzleD1Database, drizzle } from 'drizzle-orm/d1';
import type { SQLiteInsertBase } from 'drizzle-orm/sqlite-core';
import type { ItemKey } from 'tacocat-gallery-shared';
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
        .onConflictDoUpdate({ target: [item.parentPath, item.itemName], set: ITEM_UPSERT_SET });
}

/** SQLite's clock in the format the schema defaults to. */
export const NOW = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

// Built from the table so a column added to `item` is overwritten by an upsert without anyone remembering to list it.
// The id and path identify the row, so they stay.
const KEPT_ON_UPSERT = new Set(['id', 'parentPath', 'itemName', 'updatedOn']);
const ITEM_UPSERT_SET = {
    ...Object.fromEntries(
        Object.entries(getTableColumns(schema.item))
            .filter(([key]) => !KEPT_ON_UPSERT.has(key))
            .map(([key, column]) => [key, sql`excluded.${sql.identifier(column.name)}`]),
    ),
    updatedOn: NOW,
};

/** Creates an album unless one exists; an existing album keeps every field, whatever it was given here. */
export function insertAlbumIfMissing(database: Orm, key: ItemKey): BatchItem<'sqlite'> {
    const { item } = schema;
    // Unpublished until an admin decides the album is ready for visitors.
    return database
        .insert(item)
        .values({ ...key, itemType: 'album', published: false })
        .onConflictDoNothing({ target: [item.parentPath, item.itemName] });
}

export * as schema from './schema';
