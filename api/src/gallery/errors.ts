import { and, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { SQLiteInsertBase } from 'drizzle-orm/sqlite-core';
import { NOW, type Orm, orm, schema } from '../db';

// A day is long enough for the admin UI to show a failed upload; the log has the rest.
const KEEP_HOURS = 24;

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
            set: { message: sql`excluded.message`, updatedAt: NOW },
        });
}

export function uploadErrorDelete(database: Orm, path: string): BatchItem<'sqlite'> {
    const { uploadError } = schema;
    return database.delete(uploadError).where(eq(uploadError.path, path));
}

// D1 binds at most 100 parameters to one statement: one is the cutoff, and each path asked about is another.
const PATHS_PER_QUERY = 99;

/** Errors from the last day for the paths asked about, keyed by path. */
export async function recentUploadErrors(database: Orm, paths: string[]): Promise<Record<string, string>> {
    const { uploadError } = schema;
    const recent = gt(uploadError.updatedAt, cutoff());
    const found: Record<string, string> = {};
    for (let start = 0; start < paths.length; start += PATHS_PER_QUERY) {
        const asked = inArray(uploadError.path, paths.slice(start, start + PATHS_PER_QUERY));
        const rows = await database.select().from(uploadError).where(and(asked, recent)).all();
        for (const row of rows) {
            found[row.path] = row.message;
        }
    }
    return found;
}

export async function purgeUploadErrors(env: Pick<Env, 'DB'>): Promise<void> {
    const { uploadError } = schema;
    const purged = await orm(env.DB).delete(uploadError).where(lt(uploadError.updatedAt, cutoff())).run();
    console.info({ event: 'upload_errors_purged', rows: purged.meta.changes });
}

/** Same format as the column's default, so the strings compare as times. */
function cutoff(): string {
    const at = new Date(Date.now() - KEEP_HOURS * 3_600_000);
    return at.toISOString();
}
