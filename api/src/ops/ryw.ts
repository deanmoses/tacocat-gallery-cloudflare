import { and, eq } from 'drizzle-orm';
import * as valibot from 'valibot';
import { type Orm, orm, schema, upsertItem } from '../db';
import { d1Header } from '../db/timing';
import { json } from '../http/responses';

const TITLE_ROW = valibot.object({ title: valibot.nullable(valibot.string()) });

/**
 * Saves from wherever this request lands, then reads back twice: once carrying the save's bookmark (what the
 * admin UI would do) and once in a fresh session (what another visitor nearby would see). GET so that
 * measurement services, which only issue GETs, can trigger it from other continents.
 */
export async function readYourWrites(env: Env): Promise<Response> {
    const title = `ryw ${Date.now()}`;
    const key = { parentPath: '/ryw/', itemName: crypto.randomUUID() };
    const writer = env.DB.withSession('first-primary');
    let started = performance.now();
    const saved = await upsertItem(orm(writer), {
        ...key,
        itemType: 'media',
        mediaType: 'image',
        title,
        published: true,
    }).run();
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
        `write ${d1Header(saved.meta, writeMs)}`,
        `own ${String(didSeeWrite(own))} ${d1Header(own.meta, ownMs)}`,
        `fresh ${String(didSeeWrite(other))} ${d1Header(other.meta, otherMs)}`,
    ].join('; ');
    return json({ summary }, 200, { 'x-d1': summary });
}
