import ExifReader from 'exifreader';
import { type MediaType, type Size, albumsEnclosing, derivedPrefix, isVideoName } from 'tacocat-gallery-shared';
import { setThumbnail } from './albums';
import { insertAlbumIfMissing, orm, upsertItem } from './db';
import { uploadErrorDelete, uploadErrorUpsert } from './errors';
import { json, pathAfter } from './http';
import { presign } from './s3';
import { type TranscodeEnv, transcodeVideo } from './video';

/** Shape of an R2 event notification delivered through a Queue. */
export interface R2EventMessage {
    action: 'PutObject' | 'CopyObject' | 'CompleteMultipartUpload' | 'DeleteObject' | 'LifecycleDeletion';
    bucket: string;
    object: { key: string; size?: number; eTag?: string };
    eventTime: string;
}

export type UploadEnv = TranscodeEnv & Pick<Env, 'DB' | 'MEDIA'>;

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

interface ImageFacts extends Size {
    title: string | null;
    description: string | null;
}

export type ImageOutcome = { ok: true; facts: ImageFacts } | { ok: false; error: string };

interface Stored {
    placement: Placement;
    object: R2Object;
    body: ArrayBuffer | ReadableStream;
    facts: MediaFacts;
}

const ENCODER = new TextEncoder();

/**
 * Stand-in for the browser's presigned PUT: writes straight to R2 so the event notification path can be
 * exercised before S3 API credentials exist.
 */
export async function upload(request: Request, env: Env): Promise<Response> {
    const key = pathAfter(new URL(request.url), '/upload/');
    const contentType = request.headers.get('content-type');
    const object = await env.MEDIA.put(`inbox/${key}`, request.body, {
        httpMetadata: contentType === null ? {} : { contentType },
    });
    return json({ key: object.key, size: object.size });
}

/** Presigned PUT straight to R2's S3 endpoint, so upload bytes never pass through the Worker. */
export async function uploadUrl(request: Request, env: Env): Promise<Response> {
    const { path, contentType } = await request.json<{ path: string; contentType: string }>();
    const url = await presign(env, { method: 'PUT', key: `inbox/${path.replace(/^\//v, '')}`, contentType });
    return json({ url, contentType });
}

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
    const outcome = await transcodeVideo(env, key, derivedPrefix(placement.galleryPath, placement.versionId));
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

/**
 * The size of an image and the IPTC title and description, where Lightroom and Photos put them. An error for a file
 * that is not an image ExifReader can read, which is every format the gallery holds.
 */
export function readImage(bytes: ArrayBuffer): ImageOutcome {
    let tags: ExifReader.Tags;
    try {
        tags = ExifReader.load(bytes, { expanded: false });
    } catch (error) {
        return { ok: false, error: `not a readable image: ${String(error)}` };
    }
    const size = imageSize(tags);
    if (size === null) {
        return { ok: false, error: 'the image does not say its size' };
    }
    return {
        ok: true,
        facts: {
            ...size,
            title: tagText(tags.Headline) ?? tagText(tags['title']) ?? tagText(tags['ObjectName']),
            description: tagText(tags.ImageDescription) ?? tagText(tags['Caption/Abstract']),
        },
    };
}

/**
 * The size as the image is shown, from the file's own header, or the EXIF one where the file has no header ExifReader
 * reads, as HEIC. Orientations 5 to 8 turn the image a quarter turn, so it shows the other way round from how its
 * pixels are stored, and every size and crop the gallery keeps is in the shown frame.
 */
function imageSize(tags: ExifReader.Tags): Size | null {
    const width = tagNumber(tags['Image Width']) ?? tagNumber(tags.PixelXDimension);
    const height = tagNumber(tags['Image Height']) ?? tagNumber(tags.PixelYDimension);
    if (width === null || height === null) {
        return null;
    }
    const turned = (tagNumber(tags.Orientation) ?? 1) >= 5;
    return turned ? { width: height, height: width } : { width, height };
}

function tagText(tag: unknown): string | null {
    if (typeof tag !== 'object' || tag === null || !('description' in tag)) {
        return null;
    }
    const { description } = tag;
    return typeof description === 'string' && description.trim() !== '' ? description.trim() : null;
}

function tagNumber(tag: unknown): number | null {
    if (typeof tag !== 'object' || tag === null || !('value' in tag)) {
        return null;
    }
    const { value } = tag;
    return typeof value === 'number' && value > 0 ? value : null;
}
