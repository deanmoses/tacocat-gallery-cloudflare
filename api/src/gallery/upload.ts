import { type SQLWrapper, and, eq, exists, isNull, ne, notExists, sql } from 'drizzle-orm';
import type { RunnableQuery } from 'drizzle-orm/runnable-query';
import { alias } from 'drizzle-orm/sqlite-core';
import type { WorkflowStep } from 'cloudflare:workers';
import * as valibot from 'valibot';
import { type MediaType, type Size, extensionOf, isVideoName, mediaPath } from 'tacocat-gallery-shared';
import { NOW, type Orm, orm, schema } from '../db';
import { readImage } from '../media/exif';
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
type S3Env = S3Credentials & Pick<Env, 'MEDIA_BUCKET' | 'DERIVED_BUCKET'>;

export type UploadEnv = TranscodeEnv & S3Env & Pick<Env, 'DB' | 'MEDIA' | 'DERIVED' | 'IMAGES'>;

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
 * where the state changes in a way a retry must respect, and nowhere else: one step makes everything the item needs
 * from the file, the original under a key that never changes and its first derivatives, so a file the Images binding
 * refuses never reaches an album; one writes the item and the upload's completion in one batch; one drops the inbox
 * object last. A video's transcode is a step of its own ahead of those, since it is the slow one and its retries
 * belong to the container. A step's result is what the next needs and never the file, which stays inside the step
 * that reads it.
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
    const prepared = await prepare(env, step, key, upload, path);
    if (prepared.outcome === 'rejected') {
        await step.do('record the rejection', async () => reject(env, key, path, prepared.error));
        return;
    }
    if (prepared.outcome !== 'ready') {
        return;
    }
    const outcome = await step.do('write the item', async () => recordUpload(database, upload, prepared.facts));
    if (!outcome.ok) {
        await step.do('record the refusal', async () => {
            await uploadErrorUpsert(database, path, outcome.error).run();
        });
        console.error({ event: 'upload_refused', path, versionId, error: outcome.error });
        return;
    }
    await step.do('drop the inbox object', async () => env.MEDIA.delete(key));
    console.info({ event: 'upload_processed', path, versionId, ...prepared.facts });
}

type Prepared =
    | { outcome: 'redelivered' | 'gone' }
    | { outcome: 'rejected'; error: string }
    | { outcome: 'ready'; facts: MediaFacts };

/**
 * Everything the item needs from the file: its facts, the original under its permanent key, and the thumbnail and
 * detail image. An image is read once, in one step, since its bytes cannot cross a step. A video is transcoded in a
 * step of its own, then copied, its stills coming from the poster the container wrote.
 */
async function prepare(
    env: UploadEnv,
    step: WorkflowStep,
    key: string,
    upload: Upload,
    path: string,
): Promise<Prepared> {
    const { versionId } = upload;
    if (!isVideoName(upload.itemName)) {
        return step.do('read the image, store the original and make its derivatives', async () => {
            if (await redelivered(env, key, upload)) {
                return { outcome: 'redelivered' };
            }
            const object = await env.MEDIA.get(key);
            if (!object) {
                return { outcome: 'gone' };
            }
            const bytes = await object.arrayBuffer();
            const read = await readImage(bytes);
            if (!read.ok) {
                return { outcome: 'rejected', error: read.error };
            }
            await storeOriginal(env, versionId, bytes, object, path);
            return deriving(env, path, versionId, { mediaType: 'image', ...read.facts, durationSeconds: null });
        });
    }
    const transcoded = await step.do('transcode the video', async () => {
        if (await redelivered(env, key, upload)) {
            return { outcome: 'redelivered' as const };
        }
        if ((await env.MEDIA.head(key)) === null) {
            return { outcome: 'gone' as const };
        }
        const result = await transcodeVideo(env, await transcodeJob(env, key, versionId));
        return result.ok ? { outcome: 'transcoded' as const, ...result } : { outcome: 'rejected' as const, ...result };
    });
    if (transcoded.outcome !== 'transcoded') {
        return transcoded;
    }
    // Read afresh for the copy, since the transcode may have run for minutes. ExifReader has nothing to say about a
    // video container, so the caption stays empty.
    return step.do('store the original and make its derivatives', async () => {
        const fresh = await env.MEDIA.get(key);
        if (!fresh) {
            return { outcome: 'rejected', error: 'the upload vanished during the transcode' };
        }
        await storeOriginal(env, versionId, fresh.body, fresh, path);
        const { width, height, durationSeconds } = transcoded;
        return deriving(env, path, versionId, {
            mediaType: 'video',
            title: null,
            description: null,
            tags: null,
            width,
            height,
            durationSeconds,
        });
    });
}

/** Whether the upload was already complete when this instance came to it, in which case its object is dropped. */
async function redelivered(env: UploadEnv, key: string, upload: Upload): Promise<boolean> {
    if (upload.completedAt === null) {
        return false;
    }
    await env.MEDIA.delete(key);
    return true;
}

/** The facts, once the thumbnail and the detail image are made from the stored original. */
async function deriving(env: UploadEnv, path: string, versionId: string, facts: MediaFacts): Promise<Prepared> {
    const warmed = await warmDerivatives(env, path, versionId, facts);
    return warmed.ok ? { outcome: 'ready', facts } : { outcome: 'rejected', error: warmed.error };
}

/** The file under the key it keeps for good, labelled with the path it was uploaded to. */
async function storeOriginal(
    env: UploadEnv,
    versionId: string,
    body: ArrayBuffer | ReadableStream,
    object: R2Object,
    path: string,
): Promise<void> {
    await env.MEDIA.put(originalKey(versionId), body, {
        httpMetadata: object.httpMetadata ?? {},
        customMetadata: { path },
    });
}

/**
 * Signed URLs for the container to read the source from the media bucket and write the MP4 and poster for `versionId`
 * into the derived bucket, where every derivative of a version lives.
 */
export async function transcodeJob(env: S3Env, sourceKey: string, versionId: string): Promise<TranscodeJob> {
    const media = env.MEDIA_BUCKET;
    const derived = env.DERIVED_BUCKET;
    return {
        sourceKey,
        src: await presign(env, { method: 'GET', bucket: media, key: sourceKey }),
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
 * from the album's row inside the insert; a replacement changes its target's file, type and extension, keeping the
 * captions and the crop where they still fit. Each is conditional on what it needs being there and its name being
 * free, and the completion on the item having been written, so a batch in which the item cannot be written marks
 * nothing complete and the read afterwards says why.
 */
async function recordUpload(database: Orm, upload: Upload, facts: MediaFacts): Promise<Recorded> {
    const { item } = schema;
    const path = mediaPath(upload.parentPath, upload.itemName);
    const isReplacement = upload.targetPath !== null;
    if (isReplacement && upload.targetId === null) {
        return { ok: false, error: `Media [${upload.targetPath ?? ''}] was deleted before the upload finished` };
    }
    if (upload.albumId === null) {
        return { ok: false, error: `Album [${upload.parentPath}] was deleted before the upload finished` };
    }
    const itemWritten = exists(
        database.select({ id: OTHER.id }).from(OTHER).where(eq(OTHER.versionId, upload.versionId)),
    );
    const [written] = await database.batch([
        isReplacement && upload.targetId !== null
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
                    createdAt: sql<string>`${NOW}`.as('created_at'),
                    updatedAt: sql<string>`${NOW}`.as('updated_at'),
                })
                .from(ALBUM)
                .where(and(eq(ALBUM.id, albumId), eq(ALBUM.itemType, 'album'), notExists(taken))),
        )
        .returning({ id: item.id });
}

/**
 * The target row pointed at the new file. Its name is its own base name, as it is now, with the file's extension,
 * and it changes only if no other item has that name. The captions stay, and the file's fill in where the row has
 * none. The crop is pixels of the old image, so it survives only a file of exactly the old size.
 */
export function replaceItem(database: Orm, targetId: number, upload: Upload, facts: MediaFacts): ItemWrite {
    const { item } = schema;
    const newName = sql<string>`substr(${item.itemName}, 1, instr(${item.itemName}, '.') - 1) || ${`.${extensionOf(upload.itemName)}`}`;
    const taken = database
        .select({ id: OTHER.id })
        .from(OTHER)
        .where(and(eq(OTHER.parentPath, item.parentPath), eq(OTHER.itemName, newName), ne(OTHER.id, item.id)));
    return database
        .update(item)
        .set({
            itemName: newName,
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
        .where(and(eq(item.id, targetId), eq(item.itemType, 'media'), notExists(taken)))
        .returning({ id: item.id });
}

/** The tags as the column stores them, since a value bound inside `sql` is not mapped by the column. */
function tagsJson(facts: MediaFacts): string | null {
    return facts.tags === null ? null : JSON.stringify(facts.tags);
}

const EXPLANATION = valibot.array(
    valibot.object({ album: valibot.nullable(valibot.number()), target: valibot.nullable(valibot.string()) }),
);

/** Why the item was not written: one read of what the batch's conditions looked at. */
async function explain(database: Orm, upload: Upload): Promise<string> {
    const { item } = schema;
    const result = await database.run(
        sql`SELECT
            (${database
                .select({ id: item.id })
                .from(item)
                .where(and(eq(item.id, upload.albumId ?? -1), eq(item.itemType, 'album')))}) AS album,
            (${database
                .select({ name: item.itemName })
                .from(item)
                .where(eq(item.id, upload.targetId ?? -1))}) AS target`,
    );
    const [facts] = valibot.parse(EXPLANATION, result.results);
    if (upload.targetPath !== null) {
        return facts?.target === null || facts?.target === undefined
            ? `Media [${upload.targetPath}] was deleted before the upload finished`
            : `A media item already exists at [${mediaPath(upload.parentPath, `${facts.target.slice(0, facts.target.lastIndexOf('.'))}.${extensionOf(upload.itemName)}`)}]`;
    }
    return facts?.album === null || facts?.album === undefined
        ? `Album [${upload.parentPath}] was deleted before the upload finished`
        : `A media item already exists at [${mediaPath(upload.parentPath, upload.itemName)}]`;
}

/** Records why the file could not become an item, for the admin to see, and drops it. */
async function reject(env: UploadEnv, key: string, path: string, error: string): Promise<void> {
    await uploadErrorUpsert(orm(env.DB), path, error).run();
    await env.MEDIA.delete(key);
    console.error({ event: 'upload_rejected', path, error });
}
