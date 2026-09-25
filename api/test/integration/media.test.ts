import { createExecutionContext, createMessageBatch, getQueueResult, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import heicDataUrl from '../../fixtures/FullMetadataHeic.heic?inline';
import jpgDataUrl from '../../fixtures/FullMetadata.jpg?inline';
import { and, asc, eq, or } from 'drizzle-orm';
import { imageUrl, originalUrl, parseAlbum, videoUrl } from 'tacocat-gallery-shared';
import { describe, expect, it, vi } from 'vitest';
import { orm, schema, upsertItem } from '../../src/db';
import worker from '../../src/index';
import { type R2EventMessage, type UploadEnv, processUploadEvent } from '../../src/gallery/upload';
import { derivedPrefix, originalKey, posterKey, videoKey } from '../../src/storage/keys';
import { call, callAsAdmin, parseExactly, storedItem } from '../helpers';

// Through the platform's handler type, which passes the execution context the Worker's own methods ignore.
const handler: ExportedHandler<Env, R2EventMessage> = worker;

const jpg = Uint8Array.fromBase64(jpgDataUrl.slice(jpgDataUrl.indexOf(',') + 1));
const heic = Uint8Array.fromBase64(heicDataUrl.slice(heicDataUrl.indexOf(',') + 1));

function uploadEvent(key: string): R2EventMessage {
    const now = new Date();
    return { action: 'PutObject', bucket: 'tacocat-staging-media', object: { key }, eventTime: now.toISOString() };
}

/** One batch of upload events, as the queue delivers them, with ids counting from 1. */
function uploadBatch(keys: string[]): MessageBatch<R2EventMessage> {
    return createMessageBatch<R2EventMessage>(
        'tacocat-staging-uploads',
        keys.map((key, index) => ({
            id: String(index + 1),
            timestamp: new Date(),
            attempts: 1,
            body: uploadEvent(key),
        })),
    );
}

/** Delivers one upload event through the queue and reports whether the consumer acked it. */
async function deliverUpload(key: string): Promise<string[]> {
    const batch = uploadBatch([key]);
    const ctx = createExecutionContext();
    await handler.queue?.(batch, env, ctx);
    await waitOnExecutionContext(ctx);
    const result = await getQueueResult(batch, ctx);
    return result.explicitAcks;
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

describe('upload pipeline', () => {
    it('signs a PUT to the S3 endpoint under inbox/', async () => {
        const response = await callAsAdmin('/api/upload-url', {
            method: 'POST',
            body: JSON.stringify({ path: '/2024/06-15/new.jpg', contentType: 'image/jpeg' }),
        });
        const { url } = await response.json<{ url: string }>();
        const signed = new URL(url);

        expect(signed.pathname).toBe(`/${env.MEDIA_BUCKET}/inbox/2024/06-15/new.jpg`);
        expect(signed.searchParams.get('X-Amz-Signature')).toMatch(/^[\da-f]{64}$/v);
    });

    it('moves an inbox upload to its version key, labelled with its path, and records its IPTC caption and keywords', async () => {
        await env.MEDIA.put('inbox/2024/06-15/FullMetadata.jpg', jpg, { httpMetadata: { contentType: 'image/jpeg' } });
        const acks = await deliverUpload('inbox/2024/06-15/FullMetadata.jpg');
        const inbox = await env.MEDIA.head('inbox/2024/06-15/FullMetadata.jpg');
        const item = await storedItem('/2024/06-15/', 'FullMetadata.jpg');
        const originals = await env.MEDIA.list({ prefix: 'originals/' });
        const original = await env.MEDIA.head(originalKey(String(item?.versionId)));

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
        });
        expect(originals.objects.map((object) => object.key)).toStrictEqual([originalKey(String(item?.versionId))]);
        expect(original?.httpMetadata?.contentType).toBe('image/jpeg');
        expect(original?.customMetadata).toStrictEqual({ path: '/2024/06-15/FullMetadata.jpg' });
    });

    it('records the XMP caption of a HEIC, which has no IPTC, and the album lists its tags', async () => {
        await env.MEDIA.put('inbox/2024/06-15/photo.heic', heic, { httpMetadata: { contentType: 'image/heic' } });
        await deliverUpload('inbox/2024/06-15/photo.heic');
        const album = await parseExactly(await callAsAdmin('/api/album/2024/06-15/'), parseAlbum);

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

    it('creates the year and day albums an upload lands in, unpublished, and leaves an existing one as it was', async () => {
        await upsertItem(orm(env.DB), {
            parentPath: '/1999/',
            itemName: '03-03',
            itemType: 'album',
            summary: 'Kept',
            published: true,
        }).run();
        await env.MEDIA.put('inbox/1999/03-03/kept.jpg', jpg, { httpMetadata: { contentType: 'image/jpeg' } });
        await deliverUpload('inbox/1999/03-03/kept.jpg');
        const { item } = schema;
        const albums = await orm(env.DB)
            .select({
                parentPath: item.parentPath,
                itemName: item.itemName,
                summary: item.summary,
                published: item.published,
            })
            .from(item)
            .where(and(eq(item.itemType, 'album'), or(eq(item.itemName, '1999'), eq(item.parentPath, '/1999/'))))
            .orderBy(asc(item.parentPath))
            .all();

        expect(albums).toStrictEqual([
            { parentPath: '/', itemName: '1999', summary: null, published: false },
            { parentPath: '/1999/', itemName: '03-03', summary: 'Kept', published: true },
        ]);
    });

    it('becomes the thumbnail of a day that has none, and leaves one that has', async () => {
        await env.MEDIA.put('inbox/2024/06-15/first.jpg', jpg);
        await env.MEDIA.put('inbox/2024/06-15/second.jpg', jpg);
        await deliverUpload('inbox/2024/06-15/first.jpg');
        await deliverUpload('inbox/2024/06-15/second.jpg');
        const [day, first] = await Promise.all([
            storedItem('/2024/', '06-15'),
            storedItem('/2024/06-15/', 'first.jpg'),
        ]);

        expect(first?.id).toBeDefined();
        expect(day?.thumbnailId).toBe(first?.id);
    });
});

describe('image uploads', () => {
    it('records a file that is no image instead of an item, and drops it', async () => {
        await env.MEDIA.put('inbox/2024/06-15/broken.jpg', new Uint8Array(10));
        await processUploadEvent(uploadEvent('inbox/2024/06-15/broken.jpg'), env);
        const item = await storedItem('/2024/06-15/', 'broken.jpg');
        const originals = await env.MEDIA.list({ prefix: 'originals/' });
        const inbox = await env.MEDIA.head('inbox/2024/06-15/broken.jpg');
        const listed = await callAsAdmin('/api/errors', {
            method: 'POST',
            body: JSON.stringify({ paths: ['/2024/06-15/broken.jpg'] }),
        });
        const { errors } = await listed.json<{ errors: Record<string, string> }>();

        expect(item).toBeUndefined();
        expect(originals.objects).toHaveLength(0);
        expect(inbox).toBeNull();
        expect(errors['/2024/06-15/broken.jpg']).toContain('not a readable image');
    });
});

describe('a batch of uploads', () => {
    it('acks each upload as it is stored, and leaves the one that fails and those after it for a retry', async () => {
        const first = 'inbox/2024/06-15/first.jpg';
        const second = 'inbox/2024/06-15/second.jpg';
        const third = 'inbox/2024/06-15/third.jpg';
        await Promise.all([first, second, third].map(async (key) => env.MEDIA.put(key, jpg)));
        failReading(second);
        const batch = uploadBatch([first, second, third]);
        const ctx = createExecutionContext();

        await expect(handler.queue?.(batch, env, ctx)).rejects.toThrow('R2 unavailable');

        const result = await getQueueResult(batch, ctx);
        const inbox = await env.MEDIA.list({ prefix: 'inbox/' });

        expect(result.explicitAcks).toStrictEqual(['1']);
        expect(inbox.objects.map((object) => object.key)).toStrictEqual([second, third]);
    });
});

describe('video uploads', () => {
    it('records a file ffmpeg rejects instead of an item, and drops it', async () => {
        await env.MEDIA.put('inbox/2024/06-15/broken.mov', new Uint8Array(10));
        await processUploadEvent(uploadEvent('inbox/2024/06-15/broken.mov'), withTranscoder(rejecting));
        const item = await storedItem('/2024/06-15/', 'broken.mov');
        const originals = await env.MEDIA.list({ prefix: 'originals/' });
        const inbox = await env.MEDIA.head('inbox/2024/06-15/broken.mov');
        const listed = await callAsAdmin('/api/errors', {
            method: 'POST',
            body: JSON.stringify({ paths: ['/2024/06-15/broken.mov', '/2024/06-15/fine.mov'] }),
        });
        const { errors } = await listed.json<{ errors: Record<string, string> }>();

        expect(item).toBeUndefined();
        expect(originals.objects).toHaveLength(0);
        expect(inbox).toBeNull();
        expect(Object.keys(errors)).toStrictEqual(['/2024/06-15/broken.mov']);
        expect(errors['/2024/06-15/broken.mov']).toBe('ffmpeg exited 1: moov atom not found');
    });

    it('clears the error once a later upload of the same path succeeds', async () => {
        await env.MEDIA.put('inbox/2024/06-15/again.mov', new Uint8Array(10));
        await processUploadEvent(uploadEvent('inbox/2024/06-15/again.mov'), withTranscoder(rejecting));
        await env.MEDIA.put('inbox/2024/06-15/again.mov', new Uint8Array(10));
        await processUploadEvent(uploadEvent('inbox/2024/06-15/again.mov'), withTranscoder(transcoding));
        const { uploadError } = schema;
        const remaining = await orm(env.DB)
            .select()
            .from(uploadError)
            .where(eq(uploadError.path, '/2024/06-15/again.mov'))
            .all();

        expect(remaining).toStrictEqual([]);
    });
});

describe('video upload retries', () => {
    it('leaves the upload in the inbox when the transcoder cannot be reached', async () => {
        await env.MEDIA.put('inbox/2024/06-15/later.mov', new Uint8Array(10));
        const down = withTranscoder(async () => {
            throw new Error('container unreachable');
        });
        const attempt = processUploadEvent(uploadEvent('inbox/2024/06-15/later.mov'), down);

        await expect(attempt).rejects.toThrow('container unreachable');
        await expect(env.MEDIA.head('inbox/2024/06-15/later.mov')).resolves.not.toBeNull();
        await expect(env.MEDIA.list({ prefix: 'originals/' })).resolves.toMatchObject({ objects: [] });
    });

    it('does the same event twice without a second original', async () => {
        await env.MEDIA.put('inbox/2024/06-15/clip.mov', new Uint8Array(10), {
            httpMetadata: { contentType: 'video/quicktime' },
        });
        const event = uploadEvent('inbox/2024/06-15/clip.mov');
        await processUploadEvent(event, withTranscoder(transcoding));
        // Redelivered after success, as Queues may do, with the inbox object gone.
        await processUploadEvent(event, withTranscoder(transcoding));
        const item = await storedItem('/2024/06-15/', 'clip.mov');
        const originals = await env.MEDIA.list({ prefix: 'originals/' });

        expect(item).toMatchObject({
            itemType: 'media',
            mediaType: 'video',
            width: 1080,
            height: 1920,
            durationSeconds: 9.6,
        });
        expect(originals.objects.map((object) => object.key)).toStrictEqual([originalKey(String(item?.versionId))]);
    });

    it('has the container write the MP4 and poster for the version into the derived bucket', async () => {
        await env.MEDIA.put('inbox/2024/06-15/clip.mov', new Uint8Array(10));
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
        await processUploadEvent(uploadEvent('inbox/2024/06-15/clip.mov'), recording);
        const item = await storedItem('/2024/06-15/', 'clip.mov');
        const versionId = String(item?.versionId);
        const paths = Object.fromEntries(
            Object.entries(jobs[0] ?? {}).map(([name, url]) => [name, new URL(url).pathname]),
        );

        expect(paths).toStrictEqual({
            src: `/${env.MEDIA_BUCKET}/inbox/2024/06-15/clip.mov`,
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
