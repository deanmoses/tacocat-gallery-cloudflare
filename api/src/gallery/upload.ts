import { type SQLWrapper, and, eq, exists, isNull, notExists, sql } from 'drizzle-orm';
import type { RunnableQuery } from 'drizzle-orm/runnable-query';
import { alias } from 'drizzle-orm/sqlite-core';
import type { WorkflowStep } from 'cloudflare:workers';
import * as valibot from 'valibot';
import { type MediaType, type Size, mediaPath } from '@tacocat-gallery/shared';
import { NOW, type Orm, orm, schema } from '../db';
import { readImage } from '../media/exif';
import { SNIFF_LENGTH, type SniffedMedia, sniffMedia } from '../media/sniff';
import { type TranscodeEnv, type TranscodeJob, transcodeVideo } from '../media/transcoder';
import { inboxKey, originalKey, posterKey, videoKey } from '../storage/keys';
import { type S3Credentials, presign } from '../storage/s3';
import { warmDerivatives } from './derivatives';
import { uploadErrorDelete, uploadErrorUpsert } from './errors';

/** Shape of an R2 event notification delivered through a Queue. */
export interface R2EventMessage {
    action: 'PutObject' | 'CopyObject' | 'CompleteMultipartUpload' | 'DeleteObject' | 'LifecycleDeletion';
    bucket: string;
    object: { key: string; size?: number; eTag?: string };
    eventTime: string;
}

/** What signing the transcoder's URLs takes: the credentials, and which bucket is which. */
type S3Env = S3Credentials & Pick<Env, 'UPLOADS_BUCKET' | 'DERIVED_BUCKET'>;

export type UploadEnv = TranscodeEnv & S3Env & Pick<Env, 'DB' | 'UPLOADS' | 'ORIGINALS' | 'DERIVED' | 'IMAGES'>;

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

/** The version id an upload event is about, or null for an event the pipeline has no work for. */
export function uploadVersionOf(event: R2EventMessage): string | null {
    const { key } = event.object;
    return !key.startsWith('inbox/') || event.action === 'DeleteObject' || event.action === 'LifecycleDeletion'
        ? null
        : key.slice('inbox/'.length);
}

/**
 * Turns an inbox object into a media item, or into an upload error the admin can read, as one Workflow instance's
 * steps. The object's key is a version id, and its upload row says what the id was minted for; an object nobody
 * presigned is left alone, and one whose upload is already complete is a redelivery, so it is dropped. A step ends
 * where the state changes in a way a retry must respect, and nowhere else, since each boundary persists its result
 * and costs time: one step reads what kind of file it is and, for a photo, makes everything the item needs from it,
 * the original under a key that never changes and its first derivatives, so a file the Images binding refuses never
 * reaches an album; one writes the item and the upload's completion in one batch; one drops the inbox object last. A
 * video's transcode is a step of its own, followed by one that stores its original and derivatives, since the
 * transcode is the slow one and its retries belong to the container. A step's result is what the next needs and
 * never the file, which stays inside the step that reads it.
 */
export async function runUploadPipeline(event: R2EventMessage, env: UploadEnv, step: WorkflowStep): Promise<void> {
    const versionId = uploadVersionOf(event);
    if (versionId === null) {
        return;
    }
    const key = inboxKey(versionId);
    const database = orm(env.DB);
    // Read outside the steps: whether the row is there and what it is named never change once presign wrote it. Its
    // completion, which the write step changes, is judged inside the first step, so an instance resumed after that
    // step judges it as it was.
    const upload = await database.select().from(schema.upload).where(eq(schema.upload.versionId, versionId)).get();
    if (upload === undefined) {
        console.warn({ event: 'upload_unknown', key });
        return;
    }
    const path = mediaPath(upload.parentPath, upload.itemName);
    let written: MediaFacts | null;
    try {
        written = await processUpload(env, step, key, upload, path);
    } catch (error) {
        // A step before the item was written spent its retries: the admin reads why, and the instance still ends
        // errored, with the inbox object kept for a replay.
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
    await step.do('drop the inbox object', async () => env.UPLOADS.delete(key));
    console.info({ event: 'upload_processed', path, versionId, ...written });
}

async function processUpload(
    env: UploadEnv,
    step: WorkflowStep,
    key: string,
    upload: Upload,
    path: string,
): Promise<MediaFacts | null> {
    const { versionId } = upload;
    const database = orm(env.DB);
    const prepared = await prepare(env, step, key, upload, path);
    if (prepared.outcome === 'rejected') {
        await step.do('record the rejection', async () => reject(env, key, path, prepared.error));
        return null;
    }
    if (prepared.outcome !== 'ready') {
        return null;
    }
    const outcome = await step.do('write the item', async () => recordUpload(database, upload, prepared.facts));
    if (!outcome.ok) {
        await step.do('record the refusal', async () => {
            await uploadErrorUpsert(database, path, outcome.error).run();
        });
        console.error({ event: 'upload_refused', path, versionId, error: outcome.error });
        return null;
    }
    return prepared.facts;
}

const TRANSCODE_STEP = {
    retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' },
    timeout: '30 minutes',
} as const;

type Prepared =
    | { outcome: 'redelivered' | 'gone' }
    | { outcome: 'rejected'; error: string }
    | { outcome: 'ready'; facts: MediaFacts };

type Sniffed =
    | { outcome: 'redelivered' | 'gone' }
    | { outcome: 'rejected'; error: string }
    | ({ outcome: 'sniffed' } & SniffedMedia);

/**
 * Everything the item needs from the file: its facts, the original under its permanent key, and the thumbnail and
 * detail image. What kind of file it is comes from its first bytes, whatever it was named and whatever type the
 * browser sent. A photo is then read whole in the same step, since its bytes cannot cross a step and each step
 * boundary costs time the admin waits through. A video is transcoded in a step of its own, then copied, its stills
 * coming from the poster the container wrote.
 */
async function prepare(
    env: UploadEnv,
    step: WorkflowStep,
    key: string,
    upload: Upload,
    path: string,
): Promise<Prepared> {
    const { versionId } = upload;
    const read = await step.do('read the file, and store a photo and make its derivatives', async () =>
        preparePhoto(env, key, upload, path),
    );
    if (read.outcome !== 'video') {
        return read;
    }
    const { contentType } = read;
    // Room for a long clip, and retries spaced for a container that could not start, as when every instance is busy. A
    // file ffmpeg rejects is an outcome rather than a throw, so it is never retried.
    const transcoded = await step.do('transcode the video', TRANSCODE_STEP, async () => {
        const result = await transcodeVideo(env, await transcodeJob(env, key, versionId));
        return result.ok ? { outcome: 'transcoded' as const, ...result } : { outcome: 'rejected' as const, ...result };
    });
    if (transcoded.outcome !== 'transcoded') {
        return transcoded;
    }
    // Read afresh for the copy, since the transcode may have run for minutes. ExifReader has nothing to say about a
    // video container, so the caption stays empty.
    return step.do('store the original and make its derivatives', async () => {
        const fresh = await env.UPLOADS.get(key);
        if (!fresh) {
            return { outcome: 'rejected', error: 'the upload vanished during the transcode' };
        }
        await storeOriginal(env, versionId, fresh.body, contentType, path);
        const { width, height, durationSeconds } = transcoded;
        const facts: MediaFacts = {
            mediaType: 'video',
            title: null,
            description: null,
            tags: null,
            width,
            height,
            durationSeconds,
        };
        // The binding cannot read the video itself, so a video whose transcoder wrote no poster, which only a test's
        // stand-in does, is left for its first reader.
        const poster = await env.DERIVED.get(posterKey(versionId));
        if (poster === null) {
            console.warn({ event: 'derivative_not_warmed', versionId, missing: posterKey(versionId) });
            return { outcome: 'ready', facts };
        }
        return deriving(env, path, versionId, facts, await poster.blob());
    });
}

/**
 * A photo made ready from the inbox object, or word that the object is a video, which the caller transcodes. The
 * original is stored while its derivatives are made, since both work from the bytes already read.
 */
async function preparePhoto(
    env: UploadEnv,
    key: string,
    upload: Upload,
    path: string,
): Promise<Prepared | { outcome: 'video'; contentType: string }> {
    const kind = await sniff(env, key, upload);
    if (kind.outcome !== 'sniffed') {
        return kind;
    }
    const { contentType } = kind;
    if (kind.mediaType === 'video') {
        return { outcome: 'video', contentType };
    }
    const object = await env.UPLOADS.get(key);
    if (!object) {
        return { outcome: 'gone' };
    }
    const bytes = await object.arrayBuffer();
    const read = await readImage(bytes);
    if (!read.ok) {
        return { outcome: 'rejected', error: read.error };
    }
    const file = new Blob([bytes]);
    const facts: MediaFacts = { mediaType: 'image', ...read.facts, durationSeconds: null };
    const [, prepared] = await Promise.all([
        storeOriginal(env, upload.versionId, file, contentType, path),
        deriving(env, path, upload.versionId, facts, file),
    ]);
    return prepared;
}

/** What the inbox object is, from its first bytes, once the upload is known to be still wanted and the object there. */
async function sniff(env: UploadEnv, key: string, upload: Upload): Promise<Sniffed> {
    if (await redelivered(env, key, upload)) {
        return { outcome: 'redelivered' };
    }
    const head = await env.UPLOADS.get(key, { range: { offset: 0, length: SNIFF_LENGTH } });
    if (head === null) {
        return { outcome: 'gone' };
    }
    const sniffed = sniffMedia(new Uint8Array(await head.arrayBuffer()));
    return sniffed === null
        ? { outcome: 'rejected', error: 'not a photo or video in a format the gallery takes' }
        : { outcome: 'sniffed', ...sniffed };
}

/** Whether the upload was already complete when this instance came to it, in which case its object is dropped. */
async function redelivered(env: UploadEnv, key: string, upload: Upload): Promise<boolean> {
    if (upload.completedAt === null) {
        return false;
    }
    await env.UPLOADS.delete(key);
    return true;
}

/** The facts, once the thumbnail and the detail image are made from `source`. */
async function deriving(
    env: UploadEnv,
    path: string,
    versionId: string,
    facts: MediaFacts,
    source: Blob,
): Promise<Prepared> {
    const warmed = await warmDerivatives(env, path, versionId, facts, source);
    return warmed.ok ? { outcome: 'ready', facts } : { outcome: 'rejected', error: warmed.error };
}

/** The file under the key it keeps for good, typed by what its bytes are, and labelled with the path it was uploaded to. */
async function storeOriginal(
    env: UploadEnv,
    versionId: string,
    body: Blob | ReadableStream,
    contentType: string,
    path: string,
): Promise<void> {
    await env.ORIGINALS.put(originalKey(versionId), body, { httpMetadata: { contentType }, customMetadata: { path } });
}

/**
 * Signed URLs for the container to read the source from the uploads bucket and write the MP4 and poster for
 * `versionId` into the derived bucket, where every derivative of a version lives.
 */
export async function transcodeJob(env: S3Env, sourceKey: string, versionId: string): Promise<TranscodeJob> {
    const uploads = env.UPLOADS_BUCKET;
    const derived = env.DERIVED_BUCKET;
    return {
        versionId,
        sourceKey,
        src: await presign(env, { method: 'GET', bucket: uploads, key: sourceKey }),
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
 * be written marks nothing complete and the read afterwards says why.
 */
async function recordUpload(database: Orm, upload: Upload, facts: MediaFacts): Promise<Recorded> {
    const { item } = schema;
    const path = mediaPath(upload.parentPath, upload.itemName);
    if (upload.replacement && upload.targetId === null) {
        return { ok: false, error: `Media [${path}] was deleted before the upload finished` };
    }
    if (upload.albumId === null) {
        return { ok: false, error: `Album [${upload.parentPath}] was deleted before the upload finished` };
    }
    const itemWritten = exists(
        database.select({ id: OTHER.id }).from(OTHER).where(eq(OTHER.versionId, upload.versionId)),
    );
    const [written] = await database.batch([
        upload.replacement && upload.targetId !== null
            ? replaceItem(database, upload.targetId, upload, facts)
            : insertItem(database, upload.albumId, upload, facts),
        // The first upload into a day becomes its thumbnail; an admin can pick another later.
        database
            .update(item)
            .set({
                thumbnailId: sql`(${database.select({ id: OTHER.id }).from(OTHER).where(eq(OTHER.versionId, upload.versionId))})`,
            })
            .where(and(eq(item.id, upload.albumId), eq(item.itemType, 'album'), isNull(item.thumbnailId), itemWritten)),
        uploadErrorDelete(database, path),
        database
            .update(schema.upload)
            .set({ completedAt: NOW })
            .where(and(eq(schema.upload.versionId, upload.versionId), itemWritten)),
    ]);
    return written.length > 0 ? { ok: true } : { ok: false, error: await explain(database, upload) };
}

/** A statement that writes the item and returns its id if it did. */
type ItemWrite = RunnableQuery<{ id: number }[], 'sqlite'> & SQLWrapper;

/**
 * A new item under the album's current path, unless the album is gone or the name is taken there. Drizzle's insert
 * from a select wants every column of the table, in the table's order, so the ones the file does not fill are here as
 * what the defaults would give them.
 */
export function insertItem(database: Orm, albumId: number, upload: Upload, facts: MediaFacts): ItemWrite {
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
                .where(and(eq(ALBUM.id, albumId), eq(ALBUM.itemType, 'album'), notExists(taken))),
        )
        .returning({ id: item.id });
}

/**
 * The target row pointed at the new file, under the name it has now, whatever the upload was issued for. The captions
 * stay, and the file's fill in where the row has none. The crop is pixels of the old image, so it survives only a
 * file of exactly the old size.
 */
export function replaceItem(database: Orm, targetId: number, upload: Upload, facts: MediaFacts): ItemWrite {
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
            tags: sql`coalesce(${item.tags}, ${tagsJson(facts)})`,
            thumbnailCrop: sql`CASE WHEN ${item.width} = ${facts.width} AND ${item.height} = ${facts.height} THEN ${item.thumbnailCrop} ELSE NULL END`,
        })
        .where(and(eq(item.id, targetId), eq(item.itemType, 'media')))
        .returning({ id: item.id });
}

/** The tags as the column stores them, since a value bound inside `sql` is not mapped by the column. */
function tagsJson(facts: MediaFacts): string | null {
    return facts.tags === null ? null : JSON.stringify(facts.tags);
}

const EXPLANATION = valibot.array(valibot.object({ album: valibot.nullable(valibot.number()) }));

/**
 * Why the item was not written: one read of what the batch's conditions looked at. A replacement's only condition is
 * its target's row, which the database clears from the upload when the row goes.
 */
async function explain(database: Orm, upload: Upload): Promise<string> {
    const { item } = schema;
    const path = mediaPath(upload.parentPath, upload.itemName);
    if (upload.replacement) {
        return `Media [${path}] was deleted before the upload finished`;
    }
    const result = await database.run(
        sql`SELECT
            (${database
                .select({ id: item.id })
                .from(item)
                .where(and(eq(item.id, upload.albumId ?? -1), eq(item.itemType, 'album')))}) AS album`,
    );
    const [facts] = valibot.parse(EXPLANATION, result.results);
    return facts?.album === null || facts?.album === undefined
        ? `Album [${upload.parentPath}] was deleted before the upload finished`
        : `A media item already exists at [${path}]`;
}

/** Records why the file could not become an item, for the admin to see, and drops it. */
async function reject(env: UploadEnv, key: string, path: string, error: string): Promise<void> {
    await uploadErrorUpsert(orm(env.DB), path, error).run();
    await env.UPLOADS.delete(key);
    console.error({ event: 'upload_rejected', path, error });
}
