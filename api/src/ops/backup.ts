import { asc, sql } from 'drizzle-orm';
import { type Orm, orm, schema } from '../db';

/** Nightly dump of the canonical table to R2; the FTS index is derived data and is rebuilt on restore. */
export async function backupDatabase(env: Env): Promise<{ key: string; rows: number }> {
    const rows = await itemsAfter(orm(env.DB), { parentPath: '', itemName: '' });
    const now = new Date();
    const key = `backups/d1/${now.toISOString()}.json`;
    await env.MEDIA.put(key, JSON.stringify({ table: 'item', rows }), {
        httpMetadata: { contentType: 'application/json' },
    });
    console.info({ event: 'd1_backup_written', key, rows: rows.length });
    return { key, rows: rows.length };
}

const BACKUP_PAGE = 5000;

/**
 * Every item after `cursor` in path order, a page at a time: keyset pagination, each page starting where the last
 * ended. Each page is its own request, so a write during the run can move a boundary and a row with it; the gallery
 * is a page or two.
 */
async function itemsAfter(database: Orm, cursor: { parentPath: string; itemName: string }): Promise<schema.Item[]> {
    const { item } = schema;
    const page = await database
        .select()
        .from(item)
        .where(sql`(${item.parentPath}, ${item.itemName}) > (${cursor.parentPath}, ${cursor.itemName})`)
        .orderBy(asc(item.parentPath), asc(item.itemName))
        .limit(BACKUP_PAGE)
        .all();
    const last = page.at(-1);
    return !last || page.length < BACKUP_PAGE ? page : [...page, ...(await itemsAfter(database, last))];
}
