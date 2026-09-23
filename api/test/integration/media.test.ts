import { createExecutionContext, createMessageBatch, getQueueResult, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import jpgDataUrl from '../../fixtures/FullMetadata.jpg?inline';
import { and, asc, eq, or } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { orm, schema, upsertItem } from '../../src/db';
import worker from '../../src/index';
import { type R2EventMessage, type UploadEnv, processUploadEvent } from '../../src/upload';
import { call, callAsAdmin, storedItem } from '../helpers';

// Through the platform's handler type, which passes the execution context the Worker's own methods ignore.
const handler: ExportedHandler<Env, R2EventMessage> = worker;

const jpg = Uint8Array.fromBase64(jpgDataUrl.slice(jpgDataUrl.indexOf(',') + 1));

function uploadEvent(key: string): R2EventMessage {
    const now = new Date();
    return { action: 'PutObject', bucket: 'tacocat-proto-media', object: { key }, eventTime: now.toISOString() };
}

/** One batch of upload events, as the queue delivers them, with ids counting from 1. */
function uploadBatch(keys: string[]): MessageBatch<R2EventMessage> {
    return createMessageBatch<R2EventMessage>(
        'tacocat-proto-uploads',
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

        expect(signed.pathname).toBe('/tacocat-proto-media/inbox/2024/06-15/new.jpg');
        expect(signed.searchParams.get('X-Amz-Signature')).toMatch(/^[\da-f]{64}$/v);
    });

    it('moves an inbox upload to an immutable key and records its IPTC caption', async () => {
        await env.MEDIA.put('inbox/2024/06-15/FullMetadata.jpg', jpg, { httpMetadata: { contentType: 'image/jpeg' } });
        const acks = await deliverUpload('inbox/2024/06-15/FullMetadata.jpg');
        const inbox = await env.MEDIA.head('inbox/2024/06-15/FullMetadata.jpg');
        const item = await storedItem('/2024/06-15/', 'FullMetadata.jpg');
        const originals = await env.MEDIA.list({ prefix: 'originals/2024/06-15/FullMetadata.jpg/' });

        expect(acks).toStrictEqual(['1']);
        expect(inbox).toBeNull();
        expect(item).toMatchObject({
            itemType: 'image',
            published: false,
            title: 'My Image Title',
            description: 'My image description',
        });
        expect(originals.objects.map((object) => object.key)).toStrictEqual([
            `originals/2024/06-15/FullMetadata.jpg/${String(item?.versionId)}`,
        ]);
    });

    it('creates the year and day albums an upload lands in, unpublished, and leaves an existing one as it was', async () => {
        await upsertItem(orm(env.DB), {
            parentPath: '/1999/',
            itemName: '03-03',
            itemType: 'album',
            title: 'Kept',
            published: true,
        }).run();
        await env.MEDIA.put('inbox/1999/03-03/kept.jpg', jpg, { httpMetadata: { contentType: 'image/jpeg' } });
        await deliverUpload('inbox/1999/03-03/kept.jpg');
        const { item } = schema;
        const albums = await orm(env.DB)
            .select({
                parentPath: item.parentPath,
                itemName: item.itemName,
                title: item.title,
                published: item.published,
            })
            .from(item)
            .where(and(eq(item.itemType, 'album'), or(eq(item.itemName, '1999'), eq(item.parentPath, '/1999/'))))
            .orderBy(asc(item.parentPath))
            .all();

        expect(albums).toStrictEqual([
            { parentPath: '/', itemName: '1999', title: null, published: false },
            { parentPath: '/1999/', itemName: '03-03', title: 'Kept', published: true },
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
        const originals = await env.MEDIA.list({ prefix: 'originals/2024/06-15/broken.mov/' });
        const inbox = await env.MEDIA.head('inbox/2024/06-15/broken.mov');
        const listed = await callAsAdmin('/api/errors', {
            method: 'POST',
            body: JSON.stringify({ paths: ['/2024/06-15/broken.mov', '/2024/06-15/fine.mov'] }),
        });
        const { errors } = await listed.json<{ errors: Record<string, { message: string }> }>();

        expect(item).toBeUndefined();
        expect(originals.objects).toHaveLength(0);
        expect(inbox).toBeNull();
        expect(Object.keys(errors)).toStrictEqual(['/2024/06-15/broken.mov']);
        expect(errors['/2024/06-15/broken.mov']?.message).toBe('ffmpeg exited 1: moov atom not found');
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
        await expect(env.MEDIA.list({ prefix: 'originals/2024/06-15/later.mov/' })).resolves.toMatchObject({
            objects: [],
        });
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
        const originals = await env.MEDIA.list({ prefix: 'originals/2024/06-15/clip.mov/' });

        expect(item).toMatchObject({ itemType: 'video', width: 1080, height: 1920, durationSeconds: 9.6 });
        expect(originals.objects.map((object) => object.key)).toStrictEqual([
            `originals/2024/06-15/clip.mov/${String(item?.versionId)}`,
        ]);
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

describe('serving media', () => {
    it('serves a byte range', async () => {
        await env.MEDIA.put('clip.mp4', new Uint8Array(100), { httpMetadata: { contentType: 'video/mp4' } });
        const response = await call('/v/clip.mp4', { headers: { range: 'bytes=10-19' } });
        const body = await response.arrayBuffer();

        expect(response.status).toBe(206);
        expect(response.headers.get('content-range')).toBe('bytes 10-19/100');
        expect(body.byteLength).toBe(10);
    });

    it('serves a raw object', async () => {
        await env.MEDIA.put('raw.jpg', jpg, { httpMetadata: { contentType: 'image/jpeg' } });
        const response = await call('/raw/raw.jpg');
        const body = await response.arrayBuffer();

        expect(response.headers.get('content-type')).toBe('image/jpeg');
        expect(body.byteLength).toBe(jpg.byteLength);
    });

    it('makes a video thumbnail from its poster', async () => {
        await env.MEDIA.put('derived/2024/06-15/clip.mov/v1/poster.jpg', jpg);
        const response = await call('/i/2024/06-15/clip.mov/v1?size=200x200');
        const stored = await env.DERIVED.head('derived/2024/06-15/clip.mov/v1/200x200-jpeg');

        expect(response.status).toBe(200);
        expect(response.headers.get('x-derived')).toBe('generated');
        expect(stored).not.toBeNull();
    });

    it('generates a derivative once, then serves it from the cache', async () => {
        await env.MEDIA.put('originals/2024/06-15/d.jpg/v1', jpg);
        const first = await call('/i/2024/06-15/d.jpg/v1?size=200x200');
        const stored = await env.DERIVED.head('derived/2024/06-15/d.jpg/v1/200x200-jpeg');
        const second = await call('/i/2024/06-15/d.jpg/v1?size=200x200');

        expect(first.headers.get('x-derived')).toBe('generated');
        expect(first.headers.get('content-type')).toBe('image/jpeg');
        expect(stored).not.toBeNull();
        expect(second.headers.get('x-derived')).toBe('cache-api-hit');
    });
});
