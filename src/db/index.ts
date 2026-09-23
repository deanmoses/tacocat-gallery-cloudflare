import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export { schema };

/**
 * Drizzle over D1 or a Sessions API session. Drizzle only calls prepare() and batch(), which a session has too;
 * the cast is because its types name D1Database.
 */
export function db(d1: D1Database | D1DatabaseSession) {
    return drizzle(d1 as D1Database, { schema });
}

export type Db = ReturnType<typeof db>;

/** Inserts or replaces an item's fields by path; a field left out of `values` is cleared on update. */
export function upsertItem(d: Db, values: schema.NewItem) {
    const { item } = schema;
    return d
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
