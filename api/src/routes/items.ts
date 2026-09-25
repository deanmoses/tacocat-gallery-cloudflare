import { itemWriteSchema } from 'tacocat-gallery-shared';
import * as valibot from 'valibot';
import { orm, upsertItem } from '../db';
import { d1Header } from '../db/timing';
import { written } from '../http/bookmark';
import { failure } from '../http/responses';

/**
 * `PUT /api/item` with an `ItemWrite` saves every field of that item, clearing any left out. A row the database's
 * own rules refuse is answered with the constraint's name, so whatever feeds this endpoint learns which rule the row
 * broke.
 */
export async function putItem(request: Request, env: Env): Promise<Response> {
    const body = valibot.safeParse(itemWriteSchema, await request.json());
    if (!body.success) {
        return failure(400, valibot.summarize(body.issues));
    }
    const session = env.DB.withSession('first-primary');
    const started = performance.now();
    try {
        const write = await upsertItem(orm(session), body.output).run();
        return written(session, { 'x-d1': d1Header(write.meta, performance.now() - started) });
    } catch (error) {
        const refused = constraintFailure(error);
        if (refused === null) {
            throw error;
        }
        return failure(400, refused);
    }
}

/** D1's message when a constraint refused the row, found through the error Drizzle wraps it in; null for anything else. */
function constraintFailure(error: unknown): string | null {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    const message = cause instanceof Error ? cause.message : '';
    const match = /(?:CHECK|FOREIGN KEY|UNIQUE) constraint failed(?::\s*\w+)?/v.exec(message);
    return match === null ? null : match[0];
}
