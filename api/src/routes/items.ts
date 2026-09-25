import { type ItemWrite, itemWriteSchema } from 'tacocat-gallery-shared';
import * as valibot from 'valibot';
import type { schema } from '../db';
import { orm, upsertItem } from '../db';
import { d1Header } from '../db/timing';
import { written } from '../http/bookmark';
import { failure } from '../http/responses';

/** `PUT /api/item` with an `ItemWrite` saves every field of that item, clearing any left out. */
export async function putItem(request: Request, env: Env): Promise<Response> {
    const body = valibot.safeParse(itemWriteSchema, await request.json());
    if (!body.success) {
        return failure(400, valibot.summarize(body.issues));
    }
    const session = env.DB.withSession('first-primary');
    const started = performance.now();
    const write = await upsertItem(orm(session), toRow(body.output)).run();
    return written(session, { 'x-d1': d1Header(write.meta, performance.now() - started) });
}

/** The row an item write describes: the same fields, with the tags as the column keeps them. */
function toRow(item: ItemWrite): schema.NewItem {
    if (item.itemType === 'album') {
        return item;
    }
    const { tags, ...rest } = item;
    return { ...rest, ...(tags !== undefined && { tags: tags === null ? null : tags.join(',') }) };
}
