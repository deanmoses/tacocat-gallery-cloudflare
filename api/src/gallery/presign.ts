import { and, eq } from 'drizzle-orm';
import {
    type ItemKey,
    type PresignRequest,
    type PresignResponse,
    albumKey,
    baseNameOf,
    hasStrictExtension,
    isStrictMediaName,
    mediaKey,
    mediaPath,
} from 'tacocat-gallery-shared';
import { type Orm, schema } from '../db';
import { inboxKey, mintVersionId } from '../storage/keys';
import { type S3Credentials, presign } from '../storage/s3';
import { isKey } from './writes';

/** What issuing upload URLs takes: the credentials and the bucket the browser puts into. */
export type PresignEnv = S3Credentials & Pick<Env, 'MEDIA_BUCKET'>;

export type Presigned = { uploads: PresignResponse; rowsRead: number } | { refused: string };

/** One upload as the request describes it and the album's rows place it. */
interface Planned {
    path: string;
    key: ItemKey;
    replaces: string | null;
}

/**
 * Issues a presigned PUT per upload into `albumPath`, a day album, each under a freshly minted version id, and records
 * what each is for in the upload table, which is how the pipeline later knows what an inbox object is. Refuses the
 * whole request with the message for the first thing wrong: the rules are the ones the pipeline applies again when
 * the object lands, so that what is refused here is what would have failed then.
 */
export async function presignUploads(
    env: PresignEnv,
    database: Orm,
    albumPath: string,
    entries: PresignRequest,
    username: string,
): Promise<Presigned> {
    const planned = plan(albumPath, entries);
    if ('refused' in planned) {
        return planned;
    }
    const album = albumKey(albumPath);
    if (album === null) {
        return { refused: `Invalid day album path [${albumPath}]` };
    }
    const { item } = schema;
    const [albumRow, children] = await Promise.all([
        database
            .select({ id: item.id })
            .from(item)
            .where(and(isKey(item, album), eq(item.itemType, 'album')))
            .get(),
        database
            .select({ id: item.id, itemName: item.itemName })
            .from(item)
            .where(eq(item.parentPath, albumPath))
            .all(),
    ]);
    if (albumRow === undefined) {
        return { refused: `Album does not exist: [${albumPath}]` };
    }
    const existing = new Map(children.map((child) => [child.itemName, child.id]));
    for (const upload of planned) {
        const target = upload.replaces === null ? null : mediaKey(upload.replaces);
        const targetId = target === null ? undefined : existing.get(target.itemName);
        if (target !== null && targetId === undefined) {
            return { refused: `Media not found: [${upload.replaces ?? ''}]` };
        }
        const holder = existing.get(upload.key.itemName);
        if (holder !== undefined && holder !== targetId) {
            return { refused: `A media item already exists at [${upload.path}]` };
        }
    }
    const rows = planned.map((upload) => {
        const target = upload.replaces === null ? null : mediaKey(upload.replaces);
        return {
            versionId: mintVersionId(),
            parentPath: upload.key.parentPath,
            itemName: upload.key.itemName,
            albumId: albumRow.id,
            targetId: target === null ? null : (existing.get(target.itemName) ?? null),
            targetPath: upload.replaces,
            username,
        };
    });
    // One statement per row, in one atomic batch: D1 binds at most 100 parameters to a statement, and a day's drop
    // of photos is far more rows than that allows in one insert.
    const [first, ...rest] = rows.map((row) => database.insert(schema.upload).values(row));
    if (first !== undefined) {
        await database.batch([first, ...rest]);
    }
    const uploads = await Promise.all(
        rows.map(async (row) => {
            const url = await presign(env, { method: 'PUT', bucket: env.MEDIA_BUCKET, key: inboxKey(row.versionId) });
            return [mediaPath(row.parentPath, row.itemName), { url, versionId: row.versionId }] as const;
        }),
    );
    return { uploads: Object.fromEntries(uploads), rowsRead: 1 + children.length };
}

/** Everything wrong with the request that its own text shows, before any row is read. */
function plan(albumPath: string, entries: PresignRequest): Planned[] | { refused: string } {
    const planned: Planned[] = [];
    const seen = new Set<string>();
    for (const { path, replaces } of entries) {
        const key = mediaKey(path);
        if (key === null) {
            return { refused: `Invalid media path [${path}]` };
        }
        if (replaces === undefined && !isStrictMediaName(key.itemName)) {
            return {
                refused: `Invalid media name [${key.itemName}]: lowercase letters, digits and single underscores, with an extension the gallery takes, jpg not jpeg`,
            };
        }
        if (replaces !== undefined && !hasStrictExtension(key.itemName)) {
            return {
                refused: `Invalid extension on [${key.itemName}]: lowercase, one the gallery takes, jpg not jpeg`,
            };
        }
        if (key.parentPath !== albumPath) {
            return { refused: `Media [${path}] not in album [${albumPath}]` };
        }
        if (seen.has(path)) {
            return { refused: `Duplicate media path [${path}]` };
        }
        seen.add(path);
        if (replaces !== undefined) {
            const target = mediaKey(replaces);
            if (target?.parentPath !== albumPath) {
                return { refused: `Media [${replaces}] not in album [${albumPath}]` };
            }
            if (baseNameOf(key.itemName) !== baseNameOf(target.itemName)) {
                return { refused: `Replacement [${path}] must keep the name of [${replaces}]` };
            }
        }
        planned.push({ path, key, replaces: replaces ?? null });
    }
    return planned;
}
