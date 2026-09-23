import { and, asc, eq, sql } from 'drizzle-orm';
import * as valibot from 'valibot';
import { type ItemUpsert, type Orm, orm, schema, upsertItem } from './db';
import { d1Header, pickMeta, round } from './db/timing';
import { BOOKMARK_HEADER, json } from './http';
import { inSequence } from './sequence';

const TITLE_ROW = valibot.object({ title: valibot.nullable(valibot.string()) });

export async function putItem(request: Request, env: Env): Promise<Response> {
    const item = await request.json<schema.NewItem>();
    const session = env.DB.withSession('first-primary');
    const started = performance.now();
    const write = await upsertItem(orm(session), item).run();
    const writeMs = performance.now() - started;
    return json({ written: item, d1: { ...pickMeta(write.meta), roundTripMs: round(writeMs) } }, 200, {
        [BOOKMARK_HEADER]: session.getBookmark() ?? '',
    });
}

/**
 * Saves from wherever this request lands, then reads back twice: once carrying the save's bookmark (what the
 * admin UI would do) and once in a fresh session (what another visitor nearby would see). GET so that
 * measurement services, which only issue GETs, can trigger it from other continents.
 */
export async function readYourWrites(env: Env): Promise<Response> {
    const title = `ryw ${String(Date.now())}`;
    const key = { parentPath: '/ryw/', itemName: crypto.randomUUID() };
    const writer = env.DB.withSession('first-primary');
    let started = performance.now();
    const written = await upsertItem(orm(writer), { ...key, itemType: 'image', title, published: true }).run();
    const writeMs = performance.now() - started;
    const { item } = schema;
    // Not get(), because only run() returns the D1 meta that says which replica answered.
    const select = async (database: Orm): Promise<D1Result> =>
        database
            .select({ title: item.title })
            .from(item)
            .where(and(eq(item.parentPath, key.parentPath), eq(item.itemName, key.itemName)))
            .run();
    // The rows from run() are untyped, so each is checked for the one column selected.
    const didSeeWrite = (result: D1Result): boolean => {
        const row = valibot.safeParse(TITLE_ROW, result.results[0]);
        return row.success && row.output.title === title;
    };

    const reader = env.DB.withSession(writer.getBookmark() ?? 'first-primary');
    started = performance.now();
    const own = await select(orm(reader));
    const ownMs = performance.now() - started;

    const stranger = env.DB.withSession('first-unconstrained');
    started = performance.now();
    const other = await select(orm(stranger));
    const otherMs = performance.now() - started;

    const summary = [
        `write ${d1Header(written.meta, writeMs)}`,
        `own ${String(didSeeWrite(own))} ${d1Header(own.meta, ownMs)}`,
        `fresh ${String(didSeeWrite(other))} ${d1Header(other.meta, otherMs)}`,
    ].join('; ');
    return json({ summary }, 200, { 'x-d1': summary });
}

export async function search(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const query = url.searchParams.get('q') ?? '';
    const session = env.DB.withSession('first-unconstrained');
    const started = performance.now();
    // FTS5 is outside Drizzle's model, so this is raw SQL with a bound parameter.
    const rows = await orm(session).run(
        sql`SELECT i.parent_path, i.item_name, i.title, snippet(item_fts, 2, '[', ']', '…', 8) AS snippet
            FROM item_fts JOIN item i ON i.id = item_fts.rowid
            WHERE item_fts MATCH ${query} ORDER BY rank LIMIT 50`,
    );
    const searchMs = performance.now() - started;
    return json(
        {
            q: query,
            count: rows.results.length,
            results: rows.results,
            d1: { ...pickMeta(rows.meta), roundTripMs: round(searchMs) },
        },
        200,
        { 'x-d1': d1Header(rows.meta, searchMs) },
    );
}

const SEED_WORDS = ['beach', 'birthday', 'snow', 'cat', 'taco', 'paris', 'marseille', 'hike', 'garden', 'soccer'];

/** Seeds synthetic years of albums and images so reads and search run against a gallery-sized table. */
export async function seed(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const years = Number(url.searchParams.get('years') ?? '3');
    const database = orm(env.DB);
    const statements = Array.from({ length: years })
        .keys()
        .flatMap((yearIndex) => seedYear(database, yearIndex))
        .toArray();
    // D1 caps statements per batch, so they go in batches well under it, one at a time.
    await inSequence(chunks(statements, 400), async (batch) => database.batch(batch));
    return json({ written: statements.length });
}

/** `items` in consecutive groups of at most `size`. */
function chunks<T>(items: readonly T[], size: number): [T, ...T[]][] {
    const [first, ...rest] = items.slice(0, size);
    return first === undefined ? [] : [[first, ...rest], ...chunks(items.slice(size), size)];
}

function seedYear(database: Orm, yearIndex: number): ItemUpsert[] {
    const year = String(2000 + yearIndex);
    const statements: ItemUpsert[] = [
        upsertItem(database, { parentPath: '/', itemName: year, itemType: 'album', published: true }),
    ];
    for (let dayIndex = 0; dayIndex < 60; dayIndex += 1) {
        const day = `${String((dayIndex % 12) + 1).padStart(2, '0')}-${String((dayIndex % 28) + 1).padStart(2, '0')}`;
        statements.push(
            upsertItem(database, { parentPath: `/${year}/`, itemName: day, itemType: 'album', published: true }),
        );
        for (let imageIndex = 0; imageIndex < 20; imageIndex += 1) {
            const word = SEED_WORDS[(yearIndex + dayIndex + imageIndex) % SEED_WORDS.length] ?? '';
            statements.push(
                upsertItem(database, {
                    parentPath: `/${year}/${day}/`,
                    itemName: `img_${String(imageIndex)}.jpg`,
                    itemType: 'image',
                    title: `${word} ${String(imageIndex)}`,
                    description: `A photo about ${word} on ${year}-${day}`,
                    tags: word,
                    versionId: crypto.randomUUID(),
                    published: true,
                }),
            );
        }
    }
    return statements;
}

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

/** Every item after `cursor` in path order, a page at a time: keyset pagination, each page starting where the last ended. */
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
