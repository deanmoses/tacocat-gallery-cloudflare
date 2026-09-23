import { createExecutionContext, createMessageBatch, getQueueResult, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import jpgDataUrl from '../fixtures/FullMetadata.jpg?inline';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import type { R2EventMessage } from '../src/upload';
import { call, callAsAdmin } from './helpers';

// Through the platform's handler type, which passes the execution context the Worker's own methods ignore.
const handler: ExportedHandler<Env, R2EventMessage> = worker;

const jpg = Uint8Array.fromBase64(jpgDataUrl.slice(jpgDataUrl.indexOf(',') + 1));

async function deliverUpload(key: string): Promise<string[]> {
    const now = new Date();
    const batch = createMessageBatch<R2EventMessage>('tacocat-proto-uploads', [
        {
            id: '1',
            timestamp: now,
            attempts: 1,
            body: { action: 'PutObject', bucket: 'tacocat-proto-media', object: { key }, eventTime: now.toISOString() },
        },
    ]);
    const ctx = createExecutionContext();
    await handler.queue?.(batch, env, ctx);
    await waitOnExecutionContext(ctx);
    const result = await getQueueResult(batch, ctx);
    return result.explicitAcks;
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
        const item = await env.DB.prepare('SELECT * FROM item WHERE item_name = ?').bind('FullMetadata.jpg').first();
        const originals = await env.MEDIA.list({ prefix: 'originals/2024/06-15/FullMetadata.jpg/' });

        expect(acks).toStrictEqual(['1']);
        expect(inbox).toBeNull();
        expect(item).toMatchObject({
            parent_path: '/2024/06-15/',
            item_type: 'image',
            published: 0,
            title: 'My Image Title',
            description: 'My image description',
        });
        expect(originals.objects.map((object) => object.key)).toStrictEqual([
            `originals/2024/06-15/FullMetadata.jpg/${String(item?.['version_id'])}`,
        ]);
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
