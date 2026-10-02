import { and, eq } from 'drizzle-orm';
import {
    type ItemKey,
    type PresignRequest,
    type PresignResponse,
    albumKey,
    contentTypeOf,
    mediaKey,
} from '@tacocat-gallery/shared';
import { type Orm, schema } from '../db';
import { localUploadUrl, mintVersionId, originalKey } from '../storage/keys';
import { type S3Credentials, presign } from '../storage/s3';
import { isKey } from './writes';

/** What issuing upload URLs takes: the credentials, the bucket the browser puts into, and whether uploads are local. */
export type PresignEnv = S3Credentials & Pick<Env, 'ORIGINALS_BUCKET' | 'UPLOAD_MODE'>;

export type Presigned = { uploads: PresignResponse; rowsRead: number } | { refused: string };

/** One upload as the request describes it and the album's rows place it. */
interface Planned {
    path: string;
    key: ItemKey;
    contentType: string;
    replace: boolean;
}

/**
 * Issues a presigned PUT per upload into `albumPath`, a day album, each under a freshly minted version id, and records
 * what each is for in the upload table, which is how the pipeline later knows what the object is. The PUT goes
 * straight to the original's own key and is signed with the content type the file's extension gives, so the original
 * is stored as that type and a PUT claiming another fails its signature. Refuses the whole request with the message
 * for the first thing wrong: the rules are the ones the pipeline applies again when the object lands, so that what is
 * refused here is what would have failed then. Under `wrangler dev` the URL is the Worker's own, which takes the PUT
 * into its local bucket.
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
    // One batch, so the album and its children are read from one state of the database.
    const [albumRows, children] = await database.batch([
        database
            .select({ id: item.id })
            .from(item)
            .where(and(isKey(item, album), eq(item.itemType, 'album'))),
        database.select({ id: item.id, itemName: item.itemName }).from(item).where(eq(item.parentPath, albumPath)),
    ]);
    const albumRow = albumRows[0];
    if (albumRow === undefined) {
        return { refused: `Album does not exist: [${albumPath}]` };
    }
    const existing = new Map(children.map((child) => [child.itemName, child.id]));
    for (const upload of planned) {
        const holder = existing.get(upload.key.itemName);
        if (upload.replace && holder === undefined) {
            return { refused: `Media not found: [${upload.path}]` };
        }
        if (!upload.replace && holder !== undefined) {
            return { refused: `A media item already exists at [${upload.path}]` };
        }
    }
    const minted = planned.map((upload) => ({ ...upload, versionId: mintVersionId() }));
    const rows = minted.map((upload) => ({
        versionId: upload.versionId,
        parentPath: upload.key.parentPath,
        itemName: upload.key.itemName,
        albumId: albumRow.id,
        replacement: upload.replace,
        targetId: upload.replace ? (existing.get(upload.key.itemName) ?? null) : null,
        username,
    }));
    // One statement per row, in one atomic batch: D1 binds at most 100 parameters to a statement, and a day's drop
    // of photos is far more rows than that allows in one insert.
    const [first, ...rest] = rows.map((row) => database.insert(schema.upload).values(row));
    if (first !== undefined) {
        await database.batch([first, ...rest]);
    }
    const uploads = await Promise.all(
        minted.map(async ({ path, contentType, versionId }) => {
            const url =
                env.UPLOAD_MODE === 'local'
                    ? localUploadUrl(versionId)
                    : await presign(env, {
                          method: 'PUT',
                          bucket: env.ORIGINALS_BUCKET,
                          key: originalKey(versionId),
                          contentType,
                      });
            return [path, { url, contentType, versionId }] as const;
        }),
    );
    return { uploads: Object.fromEntries(uploads), rowsRead: 1 + children.length };
}

/** Everything wrong with the request that its own text shows, before any row is read. */
function plan(albumPath: string, entries: PresignRequest): Planned[] | { refused: string } {
    const planned: Planned[] = [];
    const seen = new Set<string>();
    for (const { path, extension, replace = false } of entries) {
        const key = mediaKey(path);
        if (key === null) {
            return {
                refused: `Invalid media path [${path}]: a name of lowercase letters, digits and single underscores in a day album`,
            };
        }
        if (key.parentPath !== albumPath) {
            return { refused: `Media [${path}] not in album [${albumPath}]` };
        }
        if (seen.has(path)) {
            return { refused: `Duplicate media path [${path}]` };
        }
        seen.add(path);
        const contentType = contentTypeOf(extension);
        if (contentType === null) {
            return { refused: `Media [${path}] is a file of a type the gallery does not take: [${extension}]` };
        }
        planned.push({ path, key, contentType, replace });
    }
    return planned;
}
