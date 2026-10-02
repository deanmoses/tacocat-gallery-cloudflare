import { type SQL, type SQLWrapper, and, eq, exists, isNull, notExists, sql } from 'drizzle-orm';
import type { RunnableQuery } from 'drizzle-orm/runnable-query';
import { alias } from 'drizzle-orm/sqlite-core';
import type { WorkflowStep } from 'cloudflare:workers';
import * as valibot from 'valibot';
import { type MediaType, type Size, mediaPath } from '@tacocat-gallery/shared';
import { NOW, type Orm, orm, schema } from '../db';
import { readImage } from '../media/exif';
import { scanStart } from '../media/jpeg';
import { type TranscodeEnv, type TranscodeJob, transcodeVideo } from '../media/transcoder';
import { originalKey, posterKey, videoKey } from '../storage/keys';
import { readObject } from '../storage/read';
import { type S3Credentials, presign } from '../storage/s3';
import { type Steps, bounded, timed } from '../util/stages';
import { type ImageEnv, warmDetail } from './derivatives';
import { uploadErrorDelete, uploadErrorUpsert } from './errors';

/** Shape of an R2 event notification delivered through a Queue. */
export interface R2EventMessage {
    action: 'PutObject' | 'CopyObject' | 'CompleteMultipartUpload' | 'DeleteObject' | 'LifecycleDeletion';
    bucket: string;
    object: { key: string; size?: number; eTag?: string };
    eventTime: string;
}

/** What signing the transcoder's URLs takes: the credentials, and which bucket is which. */
type S3Env = S3Credentials & Pick<Env, 'ORIGINALS_BUCKET' | 'DERIVED_BUCKET'>;

export type UploadEnv = TranscodeEnv & S3Env & ImageEnv & Pick<Env, 'DB'>;

export type Upload = typeof schema.upload.$inferSelect;

/** What the file itself says about a media item: what the album pages need to show it. */
export interface MediaFacts extends Size {
    mediaType: MediaType;
    title: string | null;
    description: string | null;
    tags: string[] | null;
    durationSeconds: number | null;
}

const ALBUM = alias(schema.item, 'album');
const OTHER = alias(schema.item, 'other');

const ORIGINALS_PREFIX = originalKey('');

/** The version id an upload event is about, or null for an event the pipeline has no work for. */
export function uploadVersionOf(event: R2EventMessage): string | null {
    const { key } = event.object;
    return !key.startsWith(ORIGINALS_PREFIX) || event.action === 'DeleteObject' || event.action === 'LifecycleDeletion'
        ? null
        : key.slice(ORIGINALS_PREFIX.length);
}

// A step whose work reports its own failure and is not worth a second try.
const ONCE = { retries: { limit: 0, delay: 0 }, timeout: '2 minutes' } as const;

/**
 * Turns an original the browser put into the bucket into a media item, or into an upload error the admin can read, as
 * one Workflow instance's steps. The object's key is a version id, and its upload row says what the id was minted
 * for; an object nobody presigned is left alone, and one whose upload is already complete is a redelivery, so nothing
 * is done for it. A step ends where the state changes in a way a retry must respect, and nowhere else, since each
 * boundary persists its result and costs time: one reads a photo's facts, or finds the file is a video, whose
 * transcode is a step of its own, since it is the slow one and its retries belong to the container; one writes the
 * item and the upload's completion in one batch. A step's result is what the next needs and never the file, which
 * stays inside the step that reads it. The original stays where it is whatever happens, so an upload that failed can
 * be replayed. The item written, the image its page shows is made ahead of its first reader, which is a favour to
 * that reader and nothing the upload depends on.
 */
export async function runUploadPipeline(event: R2EventMessage, env: UploadEnv, step: WorkflowStep): Promise<void> {
    const versionId = uploadVersionOf(event);
    if (versionId === null) {
        return;
    }
    const database = orm(env.DB);
    // Read outside the steps: whether the row is there, what it is named and whether it is a replacement never change
    // once presign wrote it. Its album and target, which the database clears, are read by the write itself. Its
    // completion, which the write step changes, is judged inside the first step, so an instance resumed after that
    // step judges it as it was.
    const upload = await database.select().from(schema.upload).where(eq(schema.upload.versionId, versionId)).get();
    if (upload === undefined) {
        console.warn({ event: 'upload_unknown', versionId });
        return;
    }
    const path = mediaPath(upload.parentPath, upload.itemName);
    let written: MediaFacts | null;
    try {
        written = await processUpload(env, step, upload, path);
    } catch (error) {
        // A step before the item was written spent its retries: the admin reads why, and the instance still ends
        // errored.
        const message = error instanceof Error ? error.message : String(error);
        await step.do('record the failure', async () => {
            await uploadErrorUpsert(database, path, message).run();
        });
        console.error({ event: 'upload_failed', path, versionId, error: message });
        throw error;
    }
    if (written === null) {
        return;
    }
    const size = { width: written.width, height: written.height };
    try {
        await step.do('warm the detail image', ONCE, async () => warmDetail(env, path, versionId, size));
    } catch (error) {
        // The step itself failed, as when it timed out: the item is written, so the upload still succeeded.
        console.warn({ event: 'detail_not_warmed', path, versionId, error: String(error) });
    }
    console.info({ event: 'upload_processed', path, versionId, ...written });
}

async function processUpload(
    env: UploadEnv,
    step: WorkflowStep,
    upload: Upload,
    path: string,
): Promise<MediaFacts | null> {
    const { versionId } = upload;
    const database = orm(env.DB);
    const read = await readFacts(env, step, upload, path);
    if (read.outcome === 'rejected') {
        await step.do('record the rejection', async () => {
            await uploadErrorUpsert(database, path, read.error).run();
        });
        console.error({ event: 'upload_rejected', path, versionId, error: read.error });
        return null;
    }
    if (read.outcome !== 'ready') {
        return null;
    }
    const outcome = await step.do('write the item', async () => recordUpload(database, upload, read.facts));
    if (!outcome.ok) {
        await step.do('record the refusal', async () => {
            await uploadErrorUpsert(database, path, outcome.error).run();
        });
        console.error({ event: 'upload_refused', path, versionId, error: outcome.error });
        return null;
    }
    return read.facts;
}

const TRANSCODE_STEP = {
    retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' },
    timeout: '30 minutes',
} as const;

type Read =
    | { outcome: 'redelivered' | 'gone' }
    | { outcome: 'rejected'; error: string }
    | { outcome: 'ready'; facts: MediaFacts };

// Enough for the EXIF, XMP and IPTC segments a camera or Photoshop writes ahead of a JPEG's pixels, each at most 64 KB.
const START_LENGTH = 256 * 1024;

/** How long the look at an original's metadata may take, where it answers in milliseconds. */
const HEAD_LIMIT_MS = 60_000;

/**
 * Everything the item needs from the file. Whether it is a photo or a video is what the original was stored as, the
 * content type presign signed its PUT with. A photo's facts are read from it; a video is transcoded, in a step of its
 * own, and its facts are the transcoder's.
 */
async function readFacts(env: UploadEnv, step: WorkflowStep, upload: Upload, path: string): Promise<Read> {
    const { versionId } = upload;
    const read = await step.do('read the file', async ({ attempt }) =>
        staged(path, versionId, attempt, async (steps) => readPhoto(env, upload, steps)),
    );
    if (read.outcome !== 'video') {
        return read;
    }
    // Room for a long clip, and retries spaced for a container that could not start, as when every instance is busy. A
    // file ffmpeg rejects is an outcome rather than a throw, so it is never retried.
    return step.do('transcode the video', TRANSCODE_STEP, async (): Promise<Read> => {
        const result = await transcodeVideo(env, await transcodeJob(env, versionId));
        if (!result.ok) {
            return { outcome: 'rejected', error: result.error };
        }
        const { width, height, durationSeconds } = result;
        // ExifReader has nothing to say about a video container, so the caption stays empty.
        return {
            outcome: 'ready',
            facts: { mediaType: 'video', title: null, description: null, tags: null, width, height, durationSeconds },
        };
    });
}

/**
 * Runs one attempt of a step, then logs how long each of its stages took and how the attempt ended, so a slow upload
 * shows where its time went and a failed attempt, which the step retries without a word of its own, shows where it
 * stopped.
 */
async function staged<T extends { outcome: string }>(
    path: string,
    versionId: string,
    attempt: number,
    work: (steps: Steps) => Promise<T>,
): Promise<T> {
    const steps: Steps = {};
    try {
        const result = await work(steps);
        console.info({ event: 'upload_stages', path, versionId, attempt, outcome: result.outcome, ...steps });
        return result;
    } catch (error) {
        console.warn({
            event: 'upload_stages',
            path,
            versionId,
            attempt,
            outcome: 'threw',
            error: String(error),
            ...steps,
        });
        throw error;
    }
}

/** A photo's facts read from its original, or word that the original is a video, which the caller transcodes. */
async function readPhoto(env: UploadEnv, upload: Upload, steps: Steps): Promise<Read | { outcome: 'video' }> {
    if (upload.completedAt !== null) {
        return { outcome: 'redelivered' };
    }
    const key = originalKey(upload.versionId);
    const original = await bounded(steps, 'head', HEAD_LIMIT_MS, async () => env.ORIGINALS.head(key));
    if (original === null) {
        return { outcome: 'gone' };
    }
    const contentType = original.httpMetadata?.contentType;
    if (contentType?.startsWith('video/') === true) {
        return { outcome: 'video' };
    }
    const bytes = await photoBytes(env.ORIGINALS, key, contentType, steps);
    if (bytes === null) {
        return { outcome: 'gone' };
    }
    const read = await timed(steps, 'exif', async () => readImage(bytes));
    return read.ok
        ? { outcome: 'ready', facts: { mediaType: 'image', ...read.facts, durationSeconds: null } }
        : { outcome: 'rejected', error: read.error };
}

/**
 * As much of the photo as its facts are read from. A JPEG's all come ahead of its pixels, so one whose headers fit in
 * its start is never read whole. Neither read has a limit of its own beyond the stall guard in `readObject`, since a
 * 50 MB photo still arriving is not stuck, and both are bounded by the step's timeout.
 */
async function photoBytes(
    bucket: R2Bucket,
    key: string,
    contentType: string | undefined,
    steps: Steps,
): Promise<Uint8Array<ArrayBuffer> | null> {
    if (contentType === 'image/jpeg') {
        const start = await timed(steps, 'start', async () => readObject(bucket, key, START_LENGTH));
        if (start === null || scanStart(start) !== null) {
            return start;
        }
    }
    return timed(steps, 'read', async () => readObject(bucket, key));
}

/**
 * Signed URLs for the container to read the version's original and write its MP4 and poster into the derived bucket,
 * where every derivative of a version lives.
 */
export async function transcodeJob(env: S3Env, versionId: string): Promise<TranscodeJob> {
    const derived = env.DERIVED_BUCKET;
    const sourceKey = originalKey(versionId);
    return {
        versionId,
        sourceKey,
        src: await presign(env, { method: 'GET', bucket: env.ORIGINALS_BUCKET, key: sourceKey }),
        mp4Put: await presign(env, {
            method: 'PUT',
            bucket: derived,
            key: videoKey(versionId),
            contentType: 'video/mp4',
        }),
        posterPut: await presign(env, {
            method: 'PUT',
            bucket: derived,
            key: posterKey(versionId),
            contentType: 'image/jpeg',
        }),
    };
}

type Recorded = { ok: true } | { ok: false; error: string };

/**
 * The item write and the upload's completion in one batch. A new item goes under its album's path as it is now, read
 * from the album's row inside the insert; a replacement changes its target's file, type and size, keeping the name,
 * the captions and the crop where it still fits. Each is conditional on what it needs being there and, for a new
 * item, its name being free, and the completion on the item having been written, so a batch in which the item cannot
 * be written marks nothing complete and the read afterwards says why. Every statement is also conditional on the
 * upload not being complete yet: a step can be retried after its batch committed, and by then the admin may have
 * renamed, deleted or replaced the item, which the retry must leave as they are.
 */
async function recordUpload(database: Orm, upload: Upload, facts: MediaFacts): Promise<Recorded> {
    const { item } = schema;
    const path = mediaPath(upload.parentPath, upload.itemName);
    const pending = uploadPending(database, upload.versionId);
    const itemWritten = exists(
        database.select({ id: OTHER.id }).from(OTHER).where(eq(OTHER.versionId, upload.versionId)),
    );
    const [written] = await database.batch([
        upload.replacement ? replaceItem(database, upload, facts) : insertItem(database, upload, facts),
        // The first upload into a day becomes its thumbnail; an admin can pick another later.
        database
            .update(item)
            .set({
                thumbnailId: sql`(${database.select({ id: OTHER.id }).from(OTHER).where(eq(OTHER.versionId, upload.versionId))})`,
            })
            .where(
                and(
                    eq(item.id, uploadColumn(database, upload.versionId, schema.upload.albumId)),
                    eq(item.itemType, 'album'),
                    isNull(item.thumbnailId),
                    itemWritten,
                    pending,
                ),
            ),
        uploadErrorDelete(database, path, pending),
        database
            .update(schema.upload)
            .set({ completedAt: NOW })
            .where(and(eq(schema.upload.versionId, upload.versionId), isNull(schema.upload.completedAt), itemWritten)),
    ]);
    return written.length > 0 ? { ok: true } : explain(database, upload);
}

/** Whether the upload is still to be written, which the batch that writes it ends. */
function uploadPending(database: Orm, versionId: string): SQL {
    const { upload } = schema;
    return exists(
        database
            .select({ versionId: upload.versionId })
            .from(upload)
            .where(and(eq(upload.versionId, versionId), isNull(upload.completedAt))),
    );
}

/**
 * The upload's album or target as the statement runs. An id read when the instance started may since have been
 * cleared by the database, or, once cleared, given to a new item, since SQLite reuses the highest row id.
 */
function uploadColumn(
    database: Orm,
    versionId: string,
    column: typeof schema.upload.albumId | typeof schema.upload.targetId,
): SQL {
    const { upload } = schema;
    return sql`(${database.select({ id: column }).from(upload).where(eq(upload.versionId, versionId))})`;
}

/** A statement that writes the item and returns its id if it did. */
type ItemWrite = RunnableQuery<{ id: number }[], 'sqlite'> & SQLWrapper;

/**
 * A new item under the album's current path, unless the album is gone, the name is taken there or the upload is
 * already complete. Drizzle's insert from a select wants every column of the table, in the table's order, so the ones
 * the file does not fill are here as what the defaults would give them.
 */
export function insertItem(database: Orm, upload: Upload, facts: MediaFacts): ItemWrite {
    const { item } = schema;
    const albumPath = sql<string>`${ALBUM.parentPath} || ${ALBUM.itemName} || '/'`;
    const taken = database
        .select({ id: OTHER.id })
        .from(OTHER)
        .where(and(eq(OTHER.parentPath, albumPath), eq(OTHER.itemName, upload.itemName)));
    return database
        .insert(item)
        .select(
            database
                .select({
                    id: sql<number>`NULL`.as('id'),
                    parentPath: albumPath.as('parent_path'),
                    itemName: sql<string>`${upload.itemName}`.as('item_name'),
                    itemType: sql<'media'>`'media'`.as('item_type'),
                    mediaType: sql<MediaType>`${facts.mediaType}`.as('media_type'),
                    title: sql<string | null>`${facts.title}`.as('title'),
                    description: sql<string | null>`${facts.description}`.as('description'),
                    summary: sql<null>`NULL`.as('summary'),
                    tags: sql<string[] | null>`${tagsJson(facts)}`.as('tags'),
                    versionId: sql<string>`${upload.versionId}`.as('version_id'),
                    published: sql<boolean>`0`.as('published'),
                    width: sql<number>`${facts.width}`.as('width'),
                    height: sql<number>`${facts.height}`.as('height'),
                    durationSeconds: sql<number | null>`${facts.durationSeconds}`.as('duration_seconds'),
                    thumbnailId: sql<null>`NULL`.as('thumbnail_id'),
                    thumbnailCrop: sql<null>`NULL`.as('thumbnail_crop'),
                    position: sql<null>`NULL`.as('position'),
                    createdAt: sql<string>`${NOW}`.as('created_at'),
                    updatedAt: sql<string>`${NOW}`.as('updated_at'),
                })
                .from(ALBUM)
                .where(
                    and(
                        eq(ALBUM.id, uploadColumn(database, upload.versionId, schema.upload.albumId)),
                        eq(ALBUM.itemType, 'album'),
                        notExists(taken),
                        uploadPending(database, upload.versionId),
                    ),
                ),
        )
        .returning({ id: item.id });
}

/**
 * The target row pointed at the new file, under the name it has now, whatever the upload was issued for, unless the
 * upload is already complete, since the row may have been replaced again since. The captions stay, and the file's
 * fill in where the row has none; the file's tags join the row's, since a tag is never wrong for being on the old file
 * too. The crop is pixels of the old image, so it survives only a file of exactly the old size.
 */
export function replaceItem(database: Orm, upload: Upload, facts: MediaFacts): ItemWrite {
    const { item } = schema;
    return database
        .update(item)
        .set({
            mediaType: facts.mediaType,
            versionId: upload.versionId,
            width: facts.width,
            height: facts.height,
            durationSeconds: facts.durationSeconds,
            title: sql`coalesce(${item.title}, ${facts.title})`,
            description: sql`coalesce(${item.description}, ${facts.description})`,
            tags: mergedTags(item.tags, tagsJson(facts)),
            thumbnailCrop: sql`CASE WHEN ${item.width} = ${facts.width} AND ${item.height} = ${facts.height} THEN ${item.thumbnailCrop} ELSE NULL END`,
        })
        .where(
            and(
                eq(item.id, uploadColumn(database, upload.versionId, schema.upload.targetId)),
                eq(item.itemType, 'media'),
                uploadPending(database, upload.versionId),
            ),
        )
        .returning({ id: item.id });
}

/** The tags as the column stores them, since a value bound inside `sql` is not mapped by the column. */
function tagsJson(facts: MediaFacts): string | null {
    return facts.tags === null ? null : JSON.stringify(facts.tags);
}

/**
 * The row's tags and the file's, each once, in no promised order, since nothing reads one; null when there are none,
 * since the column refuses an empty list.
 */
function mergedTags(existing: SQLWrapper, incoming: string | null): SQL {
    return sql`(SELECT nullif(json_group_array(DISTINCT value), '[]') FROM (
        SELECT value FROM json_each(${existing}) UNION ALL SELECT value FROM json_each(${incoming})
    ))`;
}

const EXPLANATION = valibot.array(
    valibot.object({ done: valibot.number(), album: valibot.nullable(valibot.number()) }),
);

/**
 * Why the item was not written, or that it already was: one read of what the batch's conditions looked at. An upload
 * no longer pending was written by an earlier run; its row is taken as finished when it is gone too, since only a
 * finished row is ever disposable. A replacement's only other condition is its target's row, which the database clears
 * from the upload when the row goes.
 */
async function explain(database: Orm, upload: Upload): Promise<Recorded> {
    const { item } = schema;
    const path = mediaPath(upload.parentPath, upload.itemName);
    const result = await database.run(
        sql`SELECT
            NOT ${uploadPending(database, upload.versionId)} AS done,
            (${database
                .select({ id: item.id })
                .from(item)
                .where(
                    and(
                        eq(item.id, uploadColumn(database, upload.versionId, schema.upload.albumId)),
                        eq(item.itemType, 'album'),
                    ),
                )}) AS album`,
    );
    const [facts] = valibot.parse(EXPLANATION, result.results);
    if (facts?.done !== 0) {
        return { ok: true };
    }
    if (upload.replacement) {
        return { ok: false, error: `Media [${path}] was deleted before the upload finished` };
    }
    return {
        ok: false,
        error:
            facts.album === null
                ? `Album [${upload.parentPath}] was deleted before the upload finished`
                : `A media item already exists at [${path}]`,
    };
}
