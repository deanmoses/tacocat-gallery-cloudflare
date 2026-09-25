import { createExecutionContext, createMessageBatch, getQueueResult, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import heicDataUrl from '../../fixtures/FullMetadataHeic.heic?inline';
import jpgDataUrl from '../../fixtures/FullMetadata.jpg?inline';
import pngDataUrl from '../../fixtures/pngFormat.png?inline';
import { eq } from 'drizzle-orm';
import { imageUrl, originalUrl, parseAlbum, parsePresigned, videoUrl } from 'tacocat-gallery-shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { orm, schema } from '../../src/db';
import worker from '../../src/index';
import { type R2EventMessage, type UploadEnv, processUploadEvent } from '../../src/gallery/upload';
import { derivedPrefix, inboxKey, originalKey, posterKey, videoKey } from '../../src/storage/keys';
import { call, callAsAdmin, parseExactly, putItem, storedItem } from '../helpers';

// Through the platform's handler type, which passes the execution context the Worker's own methods ignore.
const handler: ExportedHandler<Env, R2EventMessage> = worker;

function bytes(dataUrl: string): Uint8Array {
    return Uint8Array.fromBase64(dataUrl.slice(dataUrl.indexOf(',') + 1));
}

const jpg = bytes(jpgDataUrl);
const heic = bytes(heicDataUrl);
// 220 by 212, so it is not the size of the JPEG, which is 300 by 225.
const png = bytes(pngDataUrl);

const DAY = '/2024/06-15/';
const IMAGE = { itemType: 'media', mediaType: 'image', width: 300, height: 225 } as const;

/** The year and the day album uploads go into; presign refuses an album that is not there. */
async function seedDay(): Promise<void> {
    await putItem({ parentPath: '/', itemName: '2024', itemType: 'album' });
    await putItem({ parentPath: '/2024/', itemName: '06-15', itemType: 'album' });
}

function uploadEvent(versionId: string): R2EventMessage {
    return {
        action: 'PutObject',
        bucket: 'tacocat-staging-media',
        object: { key: inboxKey(versionId) },
        eventTime: new Date().toISOString(),
    };
}

/** One batch of upload events, as the queue delivers them, with ids counting from 1. */
function uploadBatch(versionIds: string[]): MessageBatch<R2EventMessage> {
    return createMessageBatch<R2EventMessage>(
        'tacocat-staging-uploads',
        versionIds.map((versionId, index) => ({
            id: String(index + 1),
            timestamp: new Date(),
            attempts: 1,
            body: uploadEvent(versionId),
        })),
    );
}

/** Delivers one upload event through the queue and reports whether the consumer acked it. */
async function deliver(versionId: string): Promise<string[]> {
    const batch = uploadBatch([versionId]);
    const ctx = createExecutionContext();
    await handler.queue?.(batch, env, ctx);
    await waitOnExecutionContext(ctx);
    const result = await getQueueResult(batch, ctx);
    return result.explicitAcks;
}

interface Staged {
    replaces?: string;
    contentType?: string;
}

/**
 * Asks for an upload URL as the app does and puts the file in the inbox as the browser would, returning the version
 * id the upload was minted, ready for its event to be delivered.
 */
async function stage(path: string, file: Uint8Array, { replaces, contentType }: Staged = {}): Promise<string> {
    const response = await callAsAdmin(`/api/presigned${DAY}`, {
        method: 'POST',
        body: JSON.stringify([{ path, ...(replaces === undefined ? {} : { replaces }) }]),
    });
    if (!response.ok) {
        throw new Error(`presign refused: ${await response.text()}`);
    }
    const presigned = parsePresigned(await response.json())[path];
    if (presigned === undefined) {
        throw new Error(`nothing presigned for ${path}`);
    }
    await env.MEDIA.put(inboxKey(presigned.versionId), file, {
        httpMetadata: { contentType: contentType ?? 'image/jpeg' },
    });
    return presigned.versionId;
}

/** The whole upload: staged and delivered. */
async function upload(path: string, file: Uint8Array, staged: Staged = {}): Promise<string> {
    const versionId = await stage(path, file, staged);
    await deliver(versionId);
    return versionId;
}

/** Makes R2 refuse to read `failing`, as it might in an outage, while every other key reads as usual. */
function failReading(failing: string): void {
    const read = env.MEDIA.get.bind(env.MEDIA);
    vi.spyOn(env.MEDIA, 'get').mockImplementation(async (key: string) => {
        if (key === failing) {
            throw new Error('R2 unavailable');
        }
        return read(key);
    });
}

/** The bindings with the transcoder container replaced by something that answers every request with `respond`. */
function withTranscoder(respond: () => Promise<Response>): UploadEnv {
    return { ...env, TRANSCODER: { getByName: () => ({ fetch: respond }) } };
}

/** What the container reports for a portrait iPhone clip: landscape frames with a quarter-turn display matrix. */
const TRANSCODED = { output: { codedWidth: 1920, codedHeight: 1080, rotation: -90, durationSeconds: 9.6 } };

async function rejecting(): Promise<Response> {
    return Response.json({ error: 'ffmpeg exited 1: moov atom not found' }, { status: 422 });
}

async function transcoding(): Promise<Response> {
    return Response.json(TRANSCODED);
}

/** The errors the admin UI would be shown for `paths`. */
async function uploadErrors(paths: string[]): Promise<Record<string, string>> {
    const listed = await callAsAdmin('/api/errors', { method: 'POST', body: JSON.stringify({ paths }) });
    return (await listed.json<{ errors: Record<string, string> }>()).errors;
}

async function uploadRow(versionId: string): Promise<typeof schema.upload.$inferSelect | undefined> {
    return orm(env.DB).select().from(schema.upload).where(eq(schema.upload.versionId, versionId)).get();
}

describe('upload pipeline', () => {
    beforeEach(seedDay);

    it('moves an inbox upload to its version key, labelled with its path, and records its IPTC caption and keywords', async () => {
        const versionId = await stage(`${DAY}FullMetadata.jpg`, jpg);
        const acks = await deliver(versionId);
        const [inbox, item, originals, original, row] = await Promise.all([
            env.MEDIA.head(inboxKey(versionId)),
            storedItem(DAY, 'FullMetadata.jpg'),
            env.MEDIA.list({ prefix: 'originals/' }),
            env.MEDIA.head(originalKey(versionId)),
            uploadRow(versionId),
        ]);

        expect(acks).toStrictEqual(['1']);
        expect(inbox).toBeNull();
        expect(item).toMatchObject({
            itemType: 'media',
            mediaType: 'image',
            published: false,
            title: 'My Image Title',
            description: 'My image description',
            tags: ['halloween', 'dog', 'parade'],
            width: 300,
            height: 225,
            versionId,
        });
        expect(originals.objects.map((object) => object.key)).toStrictEqual([originalKey(versionId)]);
        expect(original?.httpMetadata?.contentType).toBe('image/jpeg');
        expect(original?.customMetadata).toStrictEqual({ path: `${DAY}FullMetadata.jpg` });
        expect(row?.completedAt).not.toBeNull();
    });

    it('records the XMP caption of a HEIC, which has no IPTC, and the album lists its tags', async () => {
        await upload(`${DAY}photo.heic`, heic, { contentType: 'image/heic' });
        const album = await parseExactly(await callAsAdmin(`/api/album${DAY}`), parseAlbum);

        expect(album.children).toStrictEqual([
            expect.objectContaining({
                itemName: 'photo.heic',
                title: 'Test Image Title',
                description: 'Test description',
                tags: ['test1', 'test2', 'test3'],
                dimensions: { width: 4032, height: 3024 },
            }),
        ]);
    });

    it('lands under the album as it is named when the upload finishes, not when the URL was issued', async () => {
        const versionId = await stage(`${DAY}late.jpg`, jpg);
        await callAsAdmin('/api/album-rename/2024/06-15/', {
            method: 'POST',
            body: JSON.stringify({ newName: '06-16' }),
        });
        await deliver(versionId);
        const [moved, stale] = await Promise.all([storedItem('/2024/06-16/', 'late.jpg'), storedItem(DAY, 'late.jpg')]);

        expect(moved?.versionId).toBe(versionId);
        expect(stale).toBeUndefined();
    });

    it('becomes an upload error when its album was deleted in the meantime, and waits in the inbox for the purge', async () => {
        const versionId = await stage(`${DAY}orphan.jpg`, jpg);
        await callAsAdmin(`/api/album${DAY}`, { method: 'DELETE' });
        await deliver(versionId);
        const [errors, inbox, row] = await Promise.all([
            uploadErrors([`${DAY}orphan.jpg`]),
            env.MEDIA.head(inboxKey(versionId)),
            uploadRow(versionId),
        ]);

        expect(errors[`${DAY}orphan.jpg`]).toBe(`Album [${DAY}] was deleted before the upload finished`);
        expect(inbox).not.toBeNull();
        expect(row).toMatchObject({ albumId: null, completedAt: null });
    });

    it('becomes an upload error when another item took its name in the meantime', async () => {
        const versionId = await stage(`${DAY}taken.jpg`, jpg);
        await putItem({ parentPath: DAY, itemName: 'taken.jpg', ...IMAGE, versionId: 'other' });
        await deliver(versionId);
        const [errors, item] = await Promise.all([uploadErrors([`${DAY}taken.jpg`]), storedItem(DAY, 'taken.jpg')]);

        expect(errors[`${DAY}taken.jpg`]).toBe(`A media item already exists at [${DAY}taken.jpg]`);
        expect(item?.versionId).toBe('other');
    });

    it('leaves alone an inbox object nobody asked for', async () => {
        await env.MEDIA.put(inboxKey('stray'), jpg);
        const acks = await deliver('stray');
        const [inbox, items] = await Promise.all([
            env.MEDIA.head(inboxKey('stray')),
            orm(env.DB).select().from(schema.item).where(eq(schema.item.itemType, 'media')).all(),
        ]);

        expect(acks).toStrictEqual(['1']);
        expect(inbox).not.toBeNull();
        expect(items).toStrictEqual([]);
    });

    it('becomes the thumbnail of a day that has none, and leaves one that has', async () => {
        await upload(`${DAY}first.jpg`, jpg);
        await upload(`${DAY}second.jpg`, jpg);
        const [day, first] = await Promise.all([storedItem('/2024/', '06-15'), storedItem(DAY, 'first.jpg')]);

        expect(first?.id).toBeDefined();
        expect(day?.thumbnailId).toBe(first?.id);
    });
});

describe('replacing a media item', () => {
    const CROP = { x: 10, y: 10, width: 50, height: 50 };

    beforeEach(async () => {
        await seedDay();
        await putItem({
            parentPath: DAY,
            itemName: 'felix.jpg',
            ...IMAGE,
            versionId: 'old',
            title: 'Felix',
            thumbnailCrop: CROP,
        });
        await callAsAdmin(`/api/album-thumb${DAY}`, {
            method: 'PATCH',
            body: JSON.stringify({ mediaPath: `${DAY}felix.jpg` }),
        });
    });

    it('points the row at the new file, keeping its caption, its crop when the size is unchanged, and its place as the thumbnail', async () => {
        const versionId = await upload(`${DAY}felix.jpg`, jpg, { replaces: `${DAY}felix.jpg` });
        const [felix, day] = await Promise.all([storedItem(DAY, 'felix.jpg'), storedItem('/2024/', '06-15')]);

        expect(felix).toMatchObject({
            versionId,
            title: 'Felix',
            // The row had no description, so the file's fills it in.
            description: 'My image description',
            tags: ['halloween', 'dog', 'parade'],
            thumbnailCrop: CROP,
        });
        expect(day?.thumbnailId).toBe(felix?.id);
    });

    it('takes a file in another format, renaming the item to match and dropping a crop cut from another size', async () => {
        const versionId = await upload(`${DAY}felix.png`, png, {
            replaces: `${DAY}felix.jpg`,
            contentType: 'image/png',
        });
        const [renamed, old, album] = await Promise.all([
            storedItem(DAY, 'felix.png'),
            storedItem(DAY, 'felix.jpg'),
            parseExactly(await callAsAdmin(`/api/album${DAY}`), parseAlbum),
        ]);

        expect(renamed).toMatchObject({
            versionId,
            mediaType: 'image',
            width: 220,
            height: 212,
            thumbnailCrop: null,
            title: 'Felix',
        });
        expect(old).toBeUndefined();
        expect(album.thumbnail?.path).toBe(`${DAY}felix.png`);
    });

    it('keeps a name the item was given while the upload was in flight', async () => {
        const versionId = await stage(`${DAY}felix.png`, png, {
            replaces: `${DAY}felix.jpg`,
            contentType: 'image/png',
        });
        await callAsAdmin(`/api/media-rename${DAY}felix.jpg`, {
            method: 'POST',
            body: JSON.stringify({ newName: 'cat.jpg' }),
        });
        await deliver(versionId);
        const [cat, felix] = await Promise.all([storedItem(DAY, 'cat.png'), storedItem(DAY, 'felix.png')]);

        expect(cat?.versionId).toBe(versionId);
        expect(felix).toBeUndefined();
    });

    it('becomes an upload error when the item was deleted in the meantime', async () => {
        const versionId = await stage(`${DAY}felix.jpg`, jpg, { replaces: `${DAY}felix.jpg` });
        await callAsAdmin(`/api/media${DAY}felix.jpg`, { method: 'DELETE' });
        await deliver(versionId);
        const [errors, item, row] = await Promise.all([
            uploadErrors([`${DAY}felix.jpg`]),
            storedItem(DAY, 'felix.jpg'),
            uploadRow(versionId),
        ]);

        expect(errors[`${DAY}felix.jpg`]).toBe(`Media [${DAY}felix.jpg] was deleted before the upload finished`);
        expect(item).toBeUndefined();
        expect(row).toMatchObject({ targetId: null, targetPath: `${DAY}felix.jpg`, completedAt: null });
    });

    it('becomes an upload error when another item holds the name the new format gives it', async () => {
        const versionId = await stage(`${DAY}felix.png`, png, {
            replaces: `${DAY}felix.jpg`,
            contentType: 'image/png',
        });
        await putItem({ parentPath: DAY, itemName: 'felix.png', ...IMAGE, versionId: 'other' });
        await deliver(versionId);
        const [errors, felix] = await Promise.all([uploadErrors([`${DAY}felix.png`]), storedItem(DAY, 'felix.jpg')]);

        expect(errors[`${DAY}felix.png`]).toBe(`A media item already exists at [${DAY}felix.png]`);
        expect(felix?.versionId).toBe('old');
    });

    it('turns a photo into a video, with the transcoder', async () => {
        const versionId = await stage(`${DAY}felix.mov`, new Uint8Array(10), {
            replaces: `${DAY}felix.jpg`,
            contentType: 'video/quicktime',
        });
        await processUploadEvent(uploadEvent(versionId), withTranscoder(transcoding));
        const clip = await storedItem(DAY, 'felix.mov');

        expect(clip).toMatchObject({
            versionId,
            mediaType: 'video',
            width: 1080,
            height: 1920,
            durationSeconds: 9.6,
            title: 'Felix',
            thumbnailCrop: null,
        });
    });
});

describe('image uploads', () => {
    beforeEach(seedDay);

    it('records a file that is no image instead of an item, and drops it', async () => {
        const versionId = await upload(`${DAY}broken.jpg`, new Uint8Array(10));
        const [item, originals, inbox, errors] = await Promise.all([
            storedItem(DAY, 'broken.jpg'),
            env.MEDIA.list({ prefix: 'originals/' }),
            env.MEDIA.head(inboxKey(versionId)),
            uploadErrors([`${DAY}broken.jpg`]),
        ]);

        expect(item).toBeUndefined();
        expect(originals.objects).toHaveLength(0);
        expect(inbox).toBeNull();
        expect(errors[`${DAY}broken.jpg`]).toContain('not a readable image');
    });
});

describe('a batch of uploads', () => {
    beforeEach(seedDay);

    it('acks each upload as it is stored, and leaves the one that fails and those after it for a retry', async () => {
        const versionIds = await Promise.all(
            ['first', 'second', 'third'].map(async (name) => stage(`${DAY}${name}.jpg`, jpg)),
        );
        const [, second = '', third = ''] = versionIds;
        failReading(inboxKey(second));
        const batch = uploadBatch(versionIds);
        const ctx = createExecutionContext();

        await expect(handler.queue?.(batch, env, ctx)).rejects.toThrow('R2 unavailable');

        const result = await getQueueResult(batch, ctx);
        const inbox = await env.MEDIA.list({ prefix: 'inbox/' });

        expect(result.explicitAcks).toStrictEqual(['1']);
        expect(inbox.objects.map((object) => object.key).toSorted()).toStrictEqual(
            [inboxKey(second), inboxKey(third)].toSorted(),
        );
    });
});

describe('video uploads', () => {
    beforeEach(seedDay);

    it('records a file ffmpeg rejects instead of an item, and drops it', async () => {
        const versionId = await stage(`${DAY}broken.mov`, new Uint8Array(10), { contentType: 'video/quicktime' });
        await processUploadEvent(uploadEvent(versionId), withTranscoder(rejecting));
        const [item, originals, inbox, errors] = await Promise.all([
            storedItem(DAY, 'broken.mov'),
            env.MEDIA.list({ prefix: 'originals/' }),
            env.MEDIA.head(inboxKey(versionId)),
            uploadErrors([`${DAY}broken.mov`, `${DAY}fine.mov`]),
        ]);

        expect(item).toBeUndefined();
        expect(originals.objects).toHaveLength(0);
        expect(inbox).toBeNull();
        expect(Object.keys(errors)).toStrictEqual([`${DAY}broken.mov`]);
        expect(errors[`${DAY}broken.mov`]).toBe('ffmpeg exited 1: moov atom not found');
    });

    it('clears the error once a later upload of the same path succeeds', async () => {
        const first = await stage(`${DAY}again.mov`, new Uint8Array(10));
        await processUploadEvent(uploadEvent(first), withTranscoder(rejecting));
        const second = await stage(`${DAY}again.mov`, new Uint8Array(10));
        await processUploadEvent(uploadEvent(second), withTranscoder(transcoding));
        const { uploadError } = schema;
        const remaining = await orm(env.DB)
            .select()
            .from(uploadError)
            .where(eq(uploadError.path, `${DAY}again.mov`))
            .all();

        expect(remaining).toStrictEqual([]);
    });
});

describe('video upload retries', () => {
    beforeEach(seedDay);

    it('leaves the upload in the inbox when the transcoder cannot be reached', async () => {
        const versionId = await stage(`${DAY}later.mov`, new Uint8Array(10));
        const down = withTranscoder(async () => {
            throw new Error('container unreachable');
        });
        const attempt = processUploadEvent(uploadEvent(versionId), down);

        await expect(attempt).rejects.toThrow('container unreachable');
        await expect(env.MEDIA.head(inboxKey(versionId))).resolves.not.toBeNull();
        await expect(env.MEDIA.list({ prefix: 'originals/' })).resolves.toMatchObject({ objects: [] });
    });

    it('does the same event twice without a second write, and drops the object a redelivery finds', async () => {
        const versionId = await stage(`${DAY}clip.mov`, new Uint8Array(10), { contentType: 'video/quicktime' });
        const event = uploadEvent(versionId);
        await processUploadEvent(event, withTranscoder(transcoding));
        // Redelivered after success, as Queues may do, with the inbox object gone; and once more with it back, as
        // when the delete at the end was what failed.
        await processUploadEvent(event, withTranscoder(transcoding));
        await env.MEDIA.put(inboxKey(versionId), new Uint8Array(10));
        await processUploadEvent(event, withTranscoder(transcoding));
        const [item, originals, inbox] = await Promise.all([
            storedItem(DAY, 'clip.mov'),
            env.MEDIA.list({ prefix: 'originals/' }),
            env.MEDIA.head(inboxKey(versionId)),
        ]);

        expect(item).toMatchObject({
            itemType: 'media',
            mediaType: 'video',
            width: 1080,
            height: 1920,
            durationSeconds: 9.6,
        });
        expect(originals.objects.map((object) => object.key)).toStrictEqual([originalKey(versionId)]);
        expect(inbox).toBeNull();
    });

    it('has the container write the MP4 and poster for the version into the derived bucket', async () => {
        const versionId = await stage(`${DAY}clip.mov`, new Uint8Array(10));
        const jobs: Record<string, string>[] = [];
        const recording: UploadEnv = {
            ...env,
            TRANSCODER: {
                getByName: () => ({
                    fetch: async (_input, init): Promise<Response> => {
                        jobs.push(
                            JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, string>,
                        );
                        return transcoding();
                    },
                }),
            },
        };
        await processUploadEvent(uploadEvent(versionId), recording);
        const paths = Object.fromEntries(
            Object.entries(jobs[0] ?? {}).map(([name, url]) => [name, new URL(url).pathname]),
        );

        expect(paths).toStrictEqual({
            src: `/${env.MEDIA_BUCKET}/${inboxKey(versionId)}`,
            mp4Put: `/${env.DERIVED_BUCKET}/${videoKey(versionId)}`,
            posterPut: `/${env.DERIVED_BUCKET}/${posterKey(versionId)}`,
        });
    });
});

describe('upload errors', () => {
    it('needs an admin', async () => {
        const response = await call('/api/errors', { method: 'POST', body: JSON.stringify({ paths: ['/x'] }) });

        expect(response.status).toBe(401);
    });

    it('rejects a body without paths', async () => {
        const response = await callAsAdmin('/api/errors', { method: 'POST', body: JSON.stringify({}) });

        expect(response.status).toBe(400);
    });
});

describe('serving a video', () => {
    it('serves a byte range of the MP4 the transcoder wrote for the version, from the derived bucket', async () => {
        await env.DERIVED.put(videoKey('v1'), new Uint8Array(100), { httpMetadata: { contentType: 'video/mp4' } });
        const response = await call(videoUrl('/2024/06-15/clip.mov', 'v1'), { headers: { range: 'bytes=10-19' } });
        const body = await response.arrayBuffer();

        expect(response.status).toBe(206);
        expect(response.headers.get('content-range')).toBe('bytes 10-19/100');
        expect(response.headers.get('content-type')).toBe('video/mp4');
        expect(body.byteLength).toBe(10);
    });

    it('is not found for a version with no MP4, and refuses a URL that names no version', async () => {
        const [missing, malformed] = await Promise.all([
            call(videoUrl('/2024/06-15/clip.mov', 'v2')),
            call('/v/derived/2024/06-15/clip.mov/v1/video.mp4'),
        ]);
        await Promise.all([missing.body?.cancel(), malformed.body?.cancel()]);

        expect(missing.status).toBe(404);
        expect(malformed.status).toBe(400);
    });
});

describe('serving an original', () => {
    const PHOTO = '/2024/06-15/félix beach.jpg';
    const HEIC = '/2024/06-15/IMG_0001.HEIC';

    it('serves the file as uploaded, named for a download and kept for a year', async () => {
        await env.MEDIA.put(originalKey('v1'), jpg, { httpMetadata: { contentType: 'image/jpeg' } });
        const response = await call(originalUrl(PHOTO, 'v1'));
        const body = await response.arrayBuffer();

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/jpeg');
        expect(response.headers.get('content-disposition')).toBe(
            `inline; filename="f_lix beach.jpg"; filename*=UTF-8''${encodeURIComponent('félix beach.jpg')}`,
        );
        expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
        expect(body.byteLength).toBe(jpg.byteLength);
    });

    // Only Safari shows a HEIC. The bytes here are a JPEG under a HEIC's name, as some uploads are, which the binding
    // decodes anywhere; what is tested is the route's answer, not the binding's HEIC support.
    it('answers for a HEIC with a JPEG made on the way out', async () => {
        await env.MEDIA.put(originalKey('v1'), jpg, { httpMetadata: { contentType: 'image/heic' } });
        const response = await call(originalUrl(HEIC, 'v1'));
        const body = new Uint8Array(await response.arrayBuffer());

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/jpeg');
        expect(response.headers.get('content-disposition')).toContain('filename="IMG_0001.jpg"');
        expect([...body.slice(0, 3)]).toStrictEqual([0xff, 0xd8, 0xff]);
    });

    it('gives the HEIC itself when asked, and when the binding cannot decode it', async () => {
        await env.MEDIA.put(originalKey('v1'), jpg, { httpMetadata: { contentType: 'image/heic' } });
        const asked = await call(`${originalUrl(HEIC, 'v1')}?format=original`);
        vi.spyOn(env.IMAGES, 'input').mockImplementation(() => {
            throw new Error('IMAGES_TRANSFORM_ERROR 9412: Unsupported image type');
        });
        const undecodable = await call(originalUrl(HEIC, 'v1'));
        const bodies = await Promise.all([asked.arrayBuffer(), undecodable.arrayBuffer()]);

        expect([asked.status, undecodable.status]).toStrictEqual([200, 200]);
        expect(asked.headers.get('content-type')).toBe('image/heic');
        expect(undecodable.headers.get('content-type')).toBe('image/heic');
        expect(bodies.map((body) => body.byteLength)).toStrictEqual([jpg.byteLength, jpg.byteLength]);
    });

    it('reaches nothing but originals: a version with no original is not found, whatever else the bucket holds', async () => {
        await env.MEDIA.put('inbox/2024/06-15/pending.jpg', jpg);
        await env.MEDIA.put('backups/d1/2024-06-15.json', new Uint8Array(10));
        const [pending, backup, malformed] = await Promise.all([
            call(originalUrl('/2024/06-15/pending.jpg', 'v1')),
            call('/raw/backups/d1/2024-06-15.json/v1'),
            call('/raw/originals/2024/06-15/pending.jpg/v1'),
        ]);
        await Promise.all([pending, backup, malformed].map(async (response) => response.body?.cancel()));

        expect(pending.status).toBe(404);
        expect(backup.status).toBe(400);
        expect(malformed.status).toBe(400);
    });

    it('finds the version by its id alone, whatever path the URL gives it', async () => {
        await env.MEDIA.put(originalKey('v1'), jpg, { httpMetadata: { contentType: 'image/jpeg' } });
        const response = await call(originalUrl('/1999/01-01/renamed.jpg', 'v1'));
        await response.body?.cancel();

        expect(response.status).toBe(200);
        expect(response.headers.get('content-disposition')).toContain('filename="renamed.jpg"');
    });
});

describe('serving media', () => {
    // The poster is in the derived bucket and only a video has one, so it is what tells a video from a photo: the
    // URL's file name says nothing, as it says nothing for a photo.
    it.each(['/2024/06-15/clip.mov', '/2024/06-15/renamed.jpg'])(
        'makes a video thumbnail from its poster, with the URL calling the file %s',
        async (path) => {
            await env.DERIVED.put(posterKey('v1'), jpg);
            const response = await call(`/i${path}/v1?size=200x200`);
            const stored = await env.DERIVED.head(`${derivedPrefix('v1')}/200x200-jpeg`);

            expect(response.status).toBe(200);
            expect(response.headers.get('x-derived')).toBe('generated');
            expect(stored).not.toBeNull();
        },
    );

    it('generates a derivative once, then serves it from the cache', async () => {
        await env.MEDIA.put(originalKey('v1'), jpg);
        const first = await call('/i/2024/06-15/d.jpg/v1?size=200x200');
        const stored = await env.DERIVED.head(`${derivedPrefix('v1')}/200x200-jpeg`);
        const second = await call('/i/2024/06-15/d.jpg/v1?size=200x200');

        expect(first.headers.get('x-derived')).toBe('generated');
        expect(first.headers.get('content-type')).toBe('image/jpeg');
        expect(stored).not.toBeNull();
        expect(second.headers.get('x-derived')).toBe('cache-api-hit');
    });

    it('stores a cropped thumbnail under the size and crop the web app asks for', async () => {
        await env.MEDIA.put(originalKey('v1'), jpg);
        const url = imageUrl({
            path: '/2024/06-15/d.jpg',
            versionId: 'v1',
            size: { width: 20, height: 20 },
            crop: { x: 1, y: 2, width: 30, height: 30 },
        });
        const response = await call(url);
        const stored = await env.DERIVED.head(`${derivedPrefix('v1')}/20x20-1,2,30,30-jpeg`);

        expect(response.status).toBe(200);
        expect(stored).not.toBeNull();
    });

    it.each([
        { name: 'a size the web app would not write', url: '/i/2024/06-15/d.jpg/v1?size=0200x200' },
        { name: 'a crop of three numbers', url: '/i/2024/06-15/d.jpg/v1?crop=1,2,3' },
    ])('refuses $name, and stores nothing', async ({ url }) => {
        await env.MEDIA.put(originalKey('v1'), jpg);
        const response = await call(url);
        await response.body?.cancel();
        const stored = await env.DERIVED.list({ prefix: 'derived/' });

        expect(response.status).toBe(400);
        expect(stored.objects).toStrictEqual([]);
    });
});
