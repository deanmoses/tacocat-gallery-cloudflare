import { env } from 'cloudflare:workers';
import jpgDataUrl from '../../fixtures/FullMetadata.jpg?inline';
import { imageUrl, originalUrl } from '@tacocat-gallery/shared';
import { describe, expect, it, vi } from 'vitest';
import { warmDerivatives } from '../../src/gallery/derivatives';
import { derivedPrefix, inboxKey, originalKey, posterKey } from '../../src/storage/keys';
import { fixtureBytes } from '../gallery';
import { call } from '../helpers';
import { testVersionId } from '../version-id';

// Image Transformations run only on Cloudflare's edge, so these tests stand them in at `fetch` and check what the
// Worker asks of them: which object, through a URL it signed, and with which options. That the options make the right
// pixels is checked on staging, with a photo over the Images binding's 20 MB.

const jpg = fixtureBytes(jpgDataUrl);
const TRANSFORMATIONS = { IMAGE_MODE: 'transformations' } as const;
const VERSION = testVersionId('v1');
const R2 = 'https://ed3ca575118099486baeb129959697c8.r2.cloudflarestorage.com';

interface Asked {
    url: URL;
    image: RequestInitCfPropertiesImage | undefined;
}

/** What a transformation answers when it made the image. */
function made(): Response {
    return new Response(jpg, { headers: { 'content-type': 'image/jpeg', 'cf-resized': 'internal=ok/- q=0 n=12' } });
}

/** Stands Image Transformations in with `answer`, and lists every transformation asked for. */
function standInTransformations(answer: () => Response = made): Asked[] {
    const asked: Asked[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init?: RequestInit<RequestInitCfProperties>) => {
        asked.push({ url: new URL(input instanceof Request ? input.url : String(input)), image: init?.cf?.image });
        return answer();
    });
    return asked;
}

/** The bucket and key a URL the Worker signed for R2 names. */
function signed({ url }: Asked): string {
    expect(url.origin).toBe(R2);
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/v);

    return decodeURIComponent(url.pathname);
}

describe('derived images made by Image Transformations', () => {
    it("makes a photo's thumbnail from a signed read of its original, framed and encoded as the binding did", async () => {
        await env.ORIGINALS.put(originalKey(VERSION), jpg, { httpMetadata: { contentType: 'image/jpeg' } });
        const asked = standInTransformations();
        const response = await call(`/i/2024/06-15/d/${VERSION}?size=200x200`, {}, TRANSFORMATIONS);
        await response.body?.cancel();
        const stored = await env.DERIVED.head(`${derivedPrefix(VERSION)}/200x200-webp`);

        expect(response.status).toBe(200);
        expect(response.headers.get('x-derived')).toBe('generated');
        expect(asked.map(signed)).toStrictEqual([`/staging-originals/${originalKey(VERSION)}`]);
        expect(asked[0]?.image).toStrictEqual({
            width: 200,
            height: 200,
            fit: 'cover',
            gravity: { x: 0.5, y: 1 / 3, mode: 'box-center' },
            format: 'webp',
            quality: 85,
            anim: false,
            metadata: 'none',
        });
        expect(stored?.httpMetadata?.contentType).toBe('image/webp');
    });

    it('cuts a recut thumbnail from the crop the URL brings', async () => {
        await env.ORIGINALS.put(originalKey(VERSION), jpg);
        const asked = standInTransformations();
        const url = imageUrl({
            path: '/2024/06-15/d',
            versionId: VERSION,
            size: { width: 200, height: 200 },
            crop: { x: 1, y: 2, width: 30, height: 40 },
        });
        const response = await call(url, {}, TRANSFORMATIONS);
        await response.body?.cancel();

        expect(asked[0]?.image).toStrictEqual({
            trim: { left: 1, top: 2, width: 30, height: 40 },
            width: 200,
            height: 200,
            fit: 'cover',
            format: 'webp',
            quality: 85,
            anim: false,
            metadata: 'none',
        });
    });

    it("makes a video's thumbnail from its poster, in the derived bucket", async () => {
        await env.DERIVED.put(posterKey(VERSION), jpg, { httpMetadata: { contentType: 'image/jpeg' } });
        const asked = standInTransformations();
        const response = await call(`/i/2024/06-15/clip/${VERSION}?size=200x200`, {}, TRANSFORMATIONS);
        await response.body?.cancel();

        expect(response.status).toBe(200);
        expect(asked.map(signed)).toStrictEqual([`/staging-derived/${posterKey(VERSION)}`]);
    });

    it.each([
        {
            name: 'refuses the image as no image',
            answer: () => new Response('not an image', { status: 415, headers: { 'cf-resized': 'err=9412' } }),
            tries: 1,
        },
        {
            name: 'is too busy, twice',
            answer: () => new Response('busy', { status: 503, headers: { 'cf-resized': 'err=9522' } }),
            tries: 2,
        },
        {
            name: 'hands back the image untransformed, twice',
            answer: () => new Response(jpg, { headers: { 'content-type': 'image/jpeg' } }),
            tries: 2,
        },
    ])('fails after $tries tries, storing nothing, when the transformation $name', async ({ answer, tries }) => {
        await env.ORIGINALS.put(originalKey(VERSION), jpg);
        const asked = standInTransformations(answer);
        const response = await call(`/i/2024/06-15/d/${VERSION}?size=200x200`, {}, TRANSFORMATIONS);
        await response.body?.cancel();
        const stored = await env.DERIVED.list({ prefix: 'derived/' });

        expect(response.status).toBe(500);
        expect(asked).toHaveLength(tries);
        expect(stored.objects).toStrictEqual([]);
    });

    it('stores the media page JPEG without the metadata the transformation leaves in it', async () => {
        await env.ORIGINALS.put(originalKey(VERSION), jpg, { httpMetadata: { contentType: 'image/jpeg' } });
        const asked = standInTransformations();
        const response = await call(`/i/2024/06-15/d/${VERSION}?size=1024`, {}, TRANSFORMATIONS);
        const served = new Uint8Array(await response.arrayBuffer());

        expect(asked[0]?.image).toStrictEqual({
            width: 1024,
            fit: 'scale-down',
            format: 'jpeg',
            quality: 85,
            metadata: 'none',
        });
        expect(served.byteLength).toBeLessThan(jpg.byteLength);
    });

    it("makes an upload's three images from a signed read of the file in the inbox", async () => {
        await env.UPLOADS.put(inboxKey(VERSION), jpg);
        const asked = standInTransformations();
        const warmed = await warmDerivatives(
            { ...env, ...TRANSFORMATIONS },
            '/2024/06-15/d',
            VERSION,
            { width: 300, height: 225 },
            { bucket: 'UPLOADS', key: inboxKey(VERSION), contentType: 'image/jpeg' },
            {},
        );
        const stored = await env.DERIVED.list({ prefix: `${derivedPrefix(VERSION)}/` });

        expect(warmed).toStrictEqual({ ok: true });
        expect(new Set(asked.map(signed))).toStrictEqual(new Set([`/staging-uploads/${inboxKey(VERSION)}`]));
        expect(asked.map((one) => one.image?.width ?? 0).toSorted((left, right) => left - right)).toStrictEqual([
            200, 300, 400,
        ]);
        expect(stored.objects).toHaveLength(3);
    });

    it("says an upload's image cannot be decoded when the transformation refuses it", async () => {
        await env.UPLOADS.put(inboxKey(VERSION), jpg);
        standInTransformations(() => new Response('', { status: 415, headers: { 'cf-resized': 'err=9412' } }));
        const warmed = await warmDerivatives(
            { ...env, ...TRANSFORMATIONS },
            '/2024/06-15/d',
            VERSION,
            { width: 300, height: 225 },
            { bucket: 'UPLOADS', key: inboxKey(VERSION), contentType: 'image/heic' },
            {},
        );

        expect(warmed).toStrictEqual({
            ok: false,
            error: `the image cannot be decoded: Image Transformations made nothing of ${inboxKey(VERSION)}: HTTP 415, cf-resized err=9412`,
        });
    });
});

describe('a HEIC original made into a JPEG by Image Transformations', () => {
    const HEIC = '/2024/06-15/img_0001';

    it('is a full-size JPEG made from a signed read of the original', async () => {
        await env.ORIGINALS.put(originalKey(VERSION), jpg, { httpMetadata: { contentType: 'image/heic' } });
        const asked = standInTransformations();
        const response = await call(originalUrl(HEIC, VERSION), {}, TRANSFORMATIONS);
        const body = await response.arrayBuffer();

        expect(response.headers.get('content-type')).toBe('image/jpeg');
        expect(asked.map(signed)).toStrictEqual([`/staging-originals/${originalKey(VERSION)}`]);
        expect(asked[0]?.image).toStrictEqual({ format: 'jpeg', quality: 92, metadata: 'none' });
        expect(body.byteLength).toBe(jpg.byteLength);
    });

    it('is the HEIC itself when the transformation refuses it', async () => {
        await env.ORIGINALS.put(originalKey(VERSION), jpg, { httpMetadata: { contentType: 'image/heic' } });
        standInTransformations(() => new Response('', { status: 415, headers: { 'cf-resized': 'err=9412' } }));
        const response = await call(originalUrl(HEIC, VERSION), {}, TRANSFORMATIONS);
        await response.body?.cancel();

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/heic');
    });
});
