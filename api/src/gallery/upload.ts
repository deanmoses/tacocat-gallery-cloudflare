import {
    type MediaType,
    type Size,
    VIDEO_FILE,
    albumsEnclosing,
    derivedPrefix,
    isVideoName,
} from 'tacocat-gallery-shared';
import { insertAlbumIfMissing, orm, upsertItem } from '../db';
import { readImage } from '../media/exif';
import { type TranscodeEnv, type TranscodeJob, transcodeVideo } from '../media/transcoder';
import { presign } from '../storage/presign';
import { setThumbnail } from './albums';
import { uploadErrorDelete, uploadErrorUpsert } from './errors';

/** Shape of an R2 event notification delivered through a Queue. */
export interface R2EventMessage {
    action: 'PutObject' | 'CopyObject' | 'CompleteMultipartUpload' | 'DeleteObject' | 'LifecycleDeletion';
    bucket: string;
    object: { key: string; size?: number; eTag?: string };
    eventTime: string;
}

type PresignEnv = Parameters<typeof presign>[0];

export type UploadEnv = TranscodeEnv & PresignEnv & Pick<Env, 'DB' | 'MEDIA'>;

/** Where an inbox upload belongs in the gallery, and the immutable id its original will be stored under. */
interface Placement {
    inboxKey: string;
    /** For example "/2024/06-15/photo.jpg". */
    galleryPath: string;
    parentPath: string;
    itemName: string;
    versionId: string;
}

/** What the file itself says about a media item: what the album pages need to show it. */
interface MediaFacts extends Size {
    mediaType: MediaType;
    title: string | null;
    description: string | null;
    durationSeconds: number | null;
}

interface Stored {
    placement: Placement;
    object: R2Object;
    body: ArrayBuffer | ReadableStream;
    facts: MediaFacts;
}

const ENCODER = new TextEncoder();

/**
 * Moves an inbox upload to its immutable key and records it. Safe to run again for the same event: the version id
 * comes from the event, the item is written before the original, and the inbox object is only removed at the end,
 * so a delivery that dies part way leaves nothing a retry cannot finish. A file that is not the image or video it
 * is named as is recorded as an error and dropped rather than retried.
 */
export async function processUploadEvent(event: R2EventMessage, env: UploadEnv): Promise<void> {
    const { key } = event.object;
    if (!key.startsWith('inbox/') || event.action === 'DeleteObject' || event.action === 'LifecycleDeletion') {
        return;
    }
    const object = await env.MEDIA.get(key);
    if (!object) {
        return;
    }
    const placement = await place(event);
    if (!isVideoName(placement.itemName)) {
        const bytes = await object.arrayBuffer();
        const outcome = readImage(bytes);
        if (!outcome.ok) {
            await reject(env, key, placement, outcome.error);
            return;
        }
        await store(env, {
            placement,
            object,
            body: bytes,
            facts: { mediaType: 'image', ...outcome.facts, durationSeconds: null },
        });
        return;
    }
    const job = await transcodeJob(env, key, derivedPrefix(placement.galleryPath, placement.versionId));
    const outcome = await transcodeVideo(env, job);
    if (!outcome.ok) {
        await reject(env, key, placement, outcome.error);
        return;
    }
    // Read afresh for the copy, since the first body has sat through the transcode. ExifReader has nothing to say
    // about a video container, so the caption stays empty.
    const fresh = await env.MEDIA.get(key);
    if (!fresh) {
        return;
    }
    const { width, height, durationSeconds } = outcome;
    await store(env, {
        placement,
        object: fresh,
        body: fresh.body,
        facts: { mediaType: 'video', title: null, description: null, width, height, durationSeconds },
    });
}

/** Signed URLs for the container to read the source and write the MP4 and poster under `prefix`. */
export async function transcodeJob(env: PresignEnv, sourceKey: string, prefix: string): Promise<TranscodeJob> {
    return {
        sourceKey,
        src: await presign(env, { method: 'GET', key: sourceKey }),
        mp4Put: await presign(env, { method: 'PUT', key: `${prefix}/${VIDEO_FILE}`, contentType: 'video/mp4' }),
        posterPut: await presign(env, { method: 'PUT', key: `${prefix}/poster.jpg`, contentType: 'image/jpeg' }),
    };
}

async function place(event: R2EventMessage): Promise<Placement> {
    const { key } = event.object;
    const galleryPath = key.slice('inbox'.length);
    const slash = galleryPath.lastIndexOf('/');
    return {
        inboxKey: key,
        galleryPath,
        parentPath: galleryPath.slice(0, slash + 1),
        itemName: galleryPath.slice(slash + 1),
        versionId: await versionIdFor(event),
    };
}

/** Records the item, then the original under its immutable key, then lets go of the inbox copy. */
async function store(env: UploadEnv, { placement, object, body, facts }: Stored): Promise<void> {
    const database = orm(env.DB);
    const albums = albumsEnclosing(placement.parentPath);
    const day = albums.at(-1);
    const media = { parentPath: placement.parentPath, itemName: placement.itemName };
    await database.batch([
        upsertItem(database, {
            ...media,
            itemType: 'media',
            ...facts,
            versionId: placement.versionId,
            published: false,
        }),
        // The year and day albums the upload lands in, so it has a page to appear on.
        ...albums.map((key) => insertAlbumIfMissing(database, key)),
        // The first upload into a day becomes its thumbnail; an admin can pick another later.
        ...(day === undefined ? [] : [setThumbnail(database, day, media, { onlyIfNone: true })]),
        uploadErrorDelete(database, placement.galleryPath),
    ]);
    await env.MEDIA.put(`originals${placement.galleryPath}/${placement.versionId}`, body, {
        httpMetadata: object.httpMetadata ?? {},
    });
    await env.MEDIA.delete(placement.inboxKey);
    console.info({ event: 'upload_processed', ...placement, ...facts });
}

/** Records why the upload could not become an item, for the admin to see, and drops it. */
async function reject(env: UploadEnv, key: string, placement: Placement, error: string): Promise<void> {
    await uploadErrorUpsert(orm(env.DB), placement.galleryPath, error).run();
    await env.MEDIA.delete(key);
    console.error({ event: 'upload_rejected', galleryPath: placement.galleryPath, error });
}

/**
 * Time-sortable, URL-safe id standing in for S3's versionId. The same event always yields the same id, so a
 * redelivered message repeats the same work instead of adding a copy.
 */
export async function versionIdFor(event: R2EventMessage): Promise<string> {
    const identity = [event.object.key, event.object.eTag ?? '', event.eventTime].join('\n');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', ENCODER.encode(identity)));
    return Date.parse(event.eventTime).toString(36).padStart(9, '0') + digest.toHex().slice(0, 16);
}
