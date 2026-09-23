import { and, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { SQLiteInsertBase } from 'drizzle-orm/sqlite-core';
import * as valibot from 'valibot';
import { type Orm, orm, schema } from './db';
import { json } from './http';

// A day is long enough for the admin UI to show a failed upload; the log has the rest.
const KEEP_HOURS = 24;

const PATHS = valibot.object({ paths: valibot.array(valibot.string()) });

/** Replaces any earlier error for the same path, so the record always describes the latest attempt. */
export function uploadErrorUpsert(
    database: Orm,
    path: string,
    message: string,
): SQLiteInsertBase<typeof schema.uploadError, 'async', D1Result> {
    const { uploadError } = schema;
    return database
        .insert(uploadError)
        .values({ path, message })
        .onConflictDoUpdate({
            target: uploadError.path,
            set: { message: sql`excluded.message`, createdAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` },
        });
}

export function uploadErrorDelete(database: Orm, path: string): BatchItem<'sqlite'> {
    const { uploadError } = schema;
    return database.delete(uploadError).where(eq(uploadError.path, path));
}

/** Errors from the last day for the paths asked about, keyed by path. */
export async function uploadErrors(request: Request, env: Pick<Env, 'DB'>): Promise<Response> {
    const body = valibot.safeParse(PATHS, await request.json());
    if (!body.success) {
        return json({ error: 'expected { paths: string[] }' }, 400);
    }
    const { uploadError } = schema;
    const asked = inArray(uploadError.path, body.output.paths);
    const recent = gt(uploadError.createdAt, cutoff());
    const rows =
        body.output.paths.length === 0
            ? []
            : await orm(env.DB).select().from(uploadError).where(and(asked, recent)).all();
    return json({
        errors: Object.fromEntries(rows.map((row) => [row.path, { message: row.message, createdAt: row.createdAt }])),
    });
}

export async function purgeUploadErrors(env: Pick<Env, 'DB'>): Promise<void> {
    const { uploadError } = schema;
    const purged = await orm(env.DB).delete(uploadError).where(lt(uploadError.createdAt, cutoff())).run();
    console.info({ event: 'upload_errors_purged', rows: purged.meta.changes });
}

/** Same format as the column's default, so the strings compare as times. */
function cutoff(): string {
    const at = new Date(Date.now() - KEEP_HOURS * 3_600_000);
    return at.toISOString();
}
