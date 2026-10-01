import { env } from 'cloudflare:workers';
import gifDataUrl from '../../fixtures/animated.gif?inline';
import jpgDataUrl from '../../fixtures/FullMetadata.jpg?inline';
import pngDataUrl from '../../fixtures/pngFormat.png?inline';
import { imageUrl, originalUrl, videoUrl } from '@tacocat-gallery/shared';
import { describe, expect, it, vi } from 'vitest';
import { derivedPrefix, originalKey, posterKey, videoKey } from '../../src/storage/keys';
import { fixtureBytes, jpegParts } from '../gallery';
import { call } from '../helpers';
import { testVersionId } from '../version-id';

const jpg = fixtureBytes(jpgDataUrl);
const png = fixtureBytes(pngDataUrl);
const gif = fixtureBytes(gifDataUrl);

describe('serving a video', () => {
    it('serves a byte range of the MP4 the transcoder wrote for the version, from the derived bucket', async () => {
        await env.DERIVED.put(videoKey(testVersionId('v1')), new Uint8Array(100), {
            httpMetadata: { contentType: 'video/mp4' },
        });
        const response = await call(videoUrl('/2024/06-15/clip', testVersionId('v1')), {
            headers: { range: 'bytes=10-19' },
        });
        const body = await response.arrayBuffer();

        expect(response.status).toBe(206);
        expect(response.headers.get('content-range')).toBe('bytes 10-19/100');
        expect(response.headers.get('content-type')).toBe('video/mp4');
        expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
        expect(body.byteLength).toBe(10);
    });

    it('serves the last bytes for a suffix range, which a player asks for to find the index', async () => {
        await env.DERIVED.put(videoKey(testVersionId('v1')), new Uint8Array(100), {
            httpMetadata: { contentType: 'video/mp4' },
        });
        const response = await call(videoUrl('/2024/06-15/clip', testVersionId('v1')), {
            headers: { range: 'bytes=-10' },
        });
        const body = await response.arrayBuffer();

        expect(response.status).toBe(206);
        expect(response.headers.get('content-range')).toBe('bytes 90-99/100');
        expect(body.byteLength).toBe(10);
    });

    it('refuses a range past the end of the MP4, saying how long it is', async () => {
        await env.DERIVED.put(videoKey(testVersionId('v1')), new Uint8Array(100), {
            httpMetadata: { contentType: 'video/mp4' },
        });
        const response = await call(videoUrl('/2024/06-15/clip', testVersionId('v1')), {
            headers: { range: 'bytes=100-199' },
        });
        await response.body?.cancel();

        expect(response.status).toBe(416);
        expect(response.headers.get('content-range')).toBe('bytes */100');
    });

    it('is not found for a version with no MP4, and refuses a URL that names no version', async () => {
        const [missing, malformed] = await Promise.all([
            call(videoUrl('/2024/06-15/clip', testVersionId('v2'))),
            call(`/v/derived/2024/06-15/clip.mov/${testVersionId('v1')}/video.mp4`),
        ]);
        await Promise.all([missing.body?.cancel(), malformed.body?.cancel()]);

        expect(missing.status).toBe(404);
        expect(malformed.status).toBe(400);
    });
});

describe('serving an original', () => {
    const PHOTO = '/2024/06-15/felix_beach';
    const HEIC = '/2024/06-15/img_0001';

    it('serves the file as uploaded, named for a download by its name and stored type, and kept for a year', async () => {
        await env.ORIGINALS.put(originalKey(testVersionId('v1')), jpg, { httpMetadata: { contentType: 'image/jpeg' } });
        const response = await call(originalUrl(PHOTO, testVersionId('v1')));
        const body = await response.arrayBuffer();

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/jpeg');
        expect(response.headers.get('content-disposition')).toBe(
            `inline; filename="felix_beach.jpg"; filename*=UTF-8''felix_beach.jpg`,
        );
        expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
        expect(body.byteLength).toBe(jpg.byteLength);
    });

    // Only Safari shows a HEIC. The bytes here are a JPEG under a HEIC's name, as some uploads are, which the binding
    // decodes anywhere; what is tested is the route's answer, not the binding's HEIC support.
    it('answers for a HEIC with a JPEG made on the way out', async () => {
        await env.ORIGINALS.put(originalKey(testVersionId('v1')), jpg, { httpMetadata: { contentType: 'image/heic' } });
        const response = await call(originalUrl(HEIC, testVersionId('v1')));
        const body = new Uint8Array(await response.arrayBuffer());

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/jpeg');
        expect(response.headers.get('content-disposition')).toContain('filename="img_0001.jpg"');
        expect([...body.slice(0, 3)]).toStrictEqual([0xff, 0xd8, 0xff]);
    });

    it('serves a JPEG under a HEIC name as the JPEG it is, since the stored type is what the file is', async () => {
        await env.ORIGINALS.put(originalKey(testVersionId('v1')), jpg, { httpMetadata: { contentType: 'image/jpeg' } });
        const response = await call(originalUrl(HEIC, testVersionId('v1')));
        await response.body?.cancel();

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/jpeg');
        expect(response.headers.get('content-disposition')).toContain('filename="img_0001.jpg"');
    });

    it('gives the HEIC itself when asked, and when the binding cannot decode it', async () => {
        await env.ORIGINALS.put(originalKey(testVersionId('v1')), jpg, { httpMetadata: { contentType: 'image/heic' } });
        const asked = await call(`${originalUrl(HEIC, testVersionId('v1'))}?format=original`);
        vi.spyOn(env.IMAGES, 'input').mockImplementation(() => {
            throw new Error('IMAGES_TRANSFORM_ERROR 9412: Unsupported image type');
        });
        const undecodable = await call(originalUrl(HEIC, testVersionId('v1')));
        const bodies = await Promise.all([asked.arrayBuffer(), undecodable.arrayBuffer()]);

        expect([asked.status, undecodable.status]).toStrictEqual([200, 200]);
        expect(asked.headers.get('content-type')).toBe('image/heic');
        expect(undecodable.headers.get('content-type')).toBe('image/heic');
        expect(bodies.map((body) => body.byteLength)).toStrictEqual([jpg.byteLength, jpg.byteLength]);
    });

    it('reaches nothing but originals: a version with no original is not found, whatever the other buckets hold', async () => {
        await env.UPLOADS.put('inbox/2024/06-15/pending', jpg);
        await env.ORIGINALS.put('elsewhere/2024-06-15.json', new Uint8Array(10));
        const [pending, elsewhere, malformed] = await Promise.all([
            call(originalUrl('/2024/06-15/pending', testVersionId('v1'))),
            call(`/raw/elsewhere/2024-06-15.json/${testVersionId('v1')}`),
            call(`/raw/originals/2024/06-15/pending/${testVersionId('v1')}`),
        ]);
        await Promise.all([pending, elsewhere, malformed].map(async (response) => response.body?.cancel()));

        expect(pending.status).toBe(404);
        expect(elsewhere.status).toBe(400);
        expect(malformed.status).toBe(400);
    });

    it('finds the version by its id alone, whatever path the URL gives it', async () => {
        await env.ORIGINALS.put(originalKey(testVersionId('v1')), jpg, { httpMetadata: { contentType: 'image/jpeg' } });
        const response = await call(originalUrl('/1999/01-01/renamed', testVersionId('v1')));
        await response.body?.cancel();

        expect(response.status).toBe(200);
        expect(response.headers.get('content-disposition')).toContain('filename="renamed.jpg"');
    });
});

describe('serving media', () => {
    // The poster is in the derived bucket and only a video has one, so it is what tells a video from a photo: the
    // URL's file name says nothing, as it says nothing for a photo.
    it.each(['/2024/06-15/clip', '/2024/06-15/renamed'])(
        'makes a video thumbnail from its poster, with the URL calling the file %s',
        async (path) => {
            await env.DERIVED.put(posterKey(testVersionId('v1')), jpg);
            const response = await call(`/i${path}/${testVersionId('v1')}?size=200x200`);
            const stored = await env.DERIVED.head(`${derivedPrefix(testVersionId('v1'))}/200x200-webp`);

            expect(response.status).toBe(200);
            expect(response.headers.get('x-derived')).toBe('generated');
            expect(stored).not.toBeNull();
        },
    );

    it('generates a derivative once, then serves it from the cache', async () => {
        await env.ORIGINALS.put(originalKey(testVersionId('v1')), jpg);
        const first = await call(`/i/2024/06-15/d/${testVersionId('v1')}?size=200x200`);
        const stored = await env.DERIVED.head(`${derivedPrefix(testVersionId('v1'))}/200x200-webp`);
        const second = await call(`/i/2024/06-15/d/${testVersionId('v1')}?size=200x200`);

        expect(first.headers.get('x-derived')).toBe('generated');
        expect(first.headers.get('content-type')).toBe('image/webp');
        expect(stored).not.toBeNull();
        expect(second.headers.get('x-derived')).toBe('cache-api-hit');
    });

    it.each([
        { name: 'a JPEG', file: jpg, source: 'image/jpeg', served: 'image/jpeg' },
        { name: 'a PNG', file: png, source: 'image/png', served: 'image/webp' },
        { name: 'a GIF', file: gif, source: 'image/gif', served: 'image/webp' },
    ])(
        'serves the media page its image of $name as $served, whatever the browser accepts',
        async ({ file, source, served }) => {
            await env.ORIGINALS.put(originalKey(testVersionId('v1')), file, { httpMetadata: { contentType: source } });
            const response = await call(`/i/2024/06-15/d/${testVersionId('v1')}?size=20`, {
                headers: { accept: 'image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5' },
            });
            await response.body?.cancel();
            const stored = await env.DERIVED.head(`${derivedPrefix(testVersionId('v1'))}/20`);

            expect(response.headers.get('content-type')).toBe(served);
            expect(stored?.httpMetadata?.contentType).toBe(served);
        },
    );

    // The real binding writes the original's XMP and IPTC into a JPEG, `tiff:Orientation` included, after turning the
    // pixels upright, so Safari turns them again; the local one writes no metadata at all. The stand-in hands the
    // original back, every block of it.
    it('stores and serves the media page JPEG without the EXIF, XMP and IPTC the binding leaves in it', async () => {
        vi.spyOn(env.IMAGES, 'input').mockImplementation(passingMetadataThrough);
        await env.ORIGINALS.put(originalKey(testVersionId('v1')), jpg, { httpMetadata: { contentType: 'image/jpeg' } });
        const response = await call(`/i/2024/06-15/d/${testVersionId('v1')}?size=20`);
        const served = new Uint8Array(await response.arrayBuffer());
        const stored = await env.DERIVED.get(`${derivedPrefix(testVersionId('v1'))}/20`);
        const kept = jpegParts(jpg).segments.filter((segment) => !['APP1', 'APP13'].includes(segment));

        expect(response.headers.get('content-type')).toBe('image/jpeg');
        expect(jpegParts(served).segments).toStrictEqual(kept);
        expect(jpegParts(new Uint8Array((await stored?.arrayBuffer()) ?? [])).segments).toStrictEqual(kept);
    });

    it('serves a media page image from the cache the second time, whatever format the URL names in vain', async () => {
        await env.ORIGINALS.put(originalKey(testVersionId('v1')), gif, { httpMetadata: { contentType: 'image/gif' } });
        const first = await call(`/i/2024/06-15/d/${testVersionId('v1')}?size=20`);
        await first.body?.cancel();
        const second = await call(`/i/2024/06-15/d/${testVersionId('v1')}?size=20&format=bmp`);
        await second.body?.cancel();

        expect(second.headers.get('x-derived')).toBe('cache-api-hit');
        expect(second.headers.get('content-type')).toBe('image/webp');
    });

    it('stores a cropped thumbnail under the size and crop the web app asks for', async () => {
        await env.ORIGINALS.put(originalKey(testVersionId('v1')), jpg);
        const url = imageUrl({
            path: '/2024/06-15/d',
            versionId: testVersionId('v1'),
            size: { width: 20, height: 20 },
            crop: { x: 1, y: 2, width: 30, height: 30 },
        });
        const response = await call(url);
        const stored = await env.DERIVED.head(`${derivedPrefix(testVersionId('v1'))}/20x20-1,2,30,30-webp`);

        expect(response.status).toBe(200);
        expect(stored).not.toBeNull();
    });

    it.each([
        { name: 'a size the web app would not write', url: `/i/2024/06-15/d/${testVersionId('v1')}?size=0200x200` },
        { name: 'a crop of three numbers', url: `/i/2024/06-15/d/${testVersionId('v1')}?crop=1,2,3` },
    ])('refuses $name, and stores nothing', async ({ url }) => {
        await env.ORIGINALS.put(originalKey(testVersionId('v1')), jpg);
        const response = await call(url);
        await response.body?.cancel();
        const stored = await env.DERIVED.list({ prefix: 'derived/' });

        expect(response.status).toBe(400);
        expect(stored.objects).toStrictEqual([]);
    });
});

describe('derived images through the Cache API', () => {
    const path = imageUrl({
        path: '/2001/01-01/a',
        versionId: testVersionId('v1'),
        size: { width: 200, height: 200 },
        crop: null,
    });

    /** The Server-Timing metric names, in order, without their durations. */
    function timingNames(response: Response): string[] {
        return (response.headers.get('server-timing') ?? '')
            .split(',')
            .map((metric) => metric.trim().split(';', 1)[0] ?? '');
    }

    it('reads its path percent-decoded, as the raw and video routes read theirs', async () => {
        await env.DERIVED.put(`${derivedPrefix(testVersionId('v1'))}/200x200-webp`, 'webp bytes');
        const response = await call(path.replace('/a/', '/%61/'));
        await response.body?.cancel();

        expect(response.status).toBe(200);
        expect(response.headers.get('x-derived')).toBe('stored');
    });

    it('says how long the cache lookup and the R2 read took when the colo misses', async () => {
        await env.DERIVED.put(`${derivedPrefix(testVersionId('v1'))}/200x200-webp`, 'webp bytes');
        const response = await call(path);
        await response.body?.cancel();

        expect(response.headers.get('x-derived')).toBe('stored');
        expect(timingNames(response)).toStrictEqual(['cache', 'r2', 'worker']);
    });

    it('serves a thumbnail as WebP even to a browser whose Accept header does not name it, with no Vary', async () => {
        await env.DERIVED.put(`${derivedPrefix(testVersionId('v1'))}/200x200-webp`, 'webp bytes', {
            httpMetadata: { contentType: 'image/webp' },
        });
        const response = await call(path, { headers: { accept: 'image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5' } });

        expect([response.headers.get('content-type'), await response.text()]).toStrictEqual([
            'image/webp',
            'webp bytes',
        ]);
        expect(response.headers.get('vary')).toBeNull();
    });

    it('serves every URL that names one derivative from one cache entry', async () => {
        await env.DERIVED.put(`${derivedPrefix(testVersionId('v1'))}/200x200-webp`, 'webp bytes');
        const first = await call(path);
        await first.body?.cancel();
        const renamed = await call(path.replace('/a/', '/renamed/'));
        await renamed.body?.cancel();
        const tagged = await call(`${path}&utm_source=email`);
        await tagged.body?.cancel();

        expect([renamed.headers.get('x-derived'), tagged.headers.get('x-derived')]).toStrictEqual([
            'cache-api-hit',
            'cache-api-hit',
        ]);
    });

    it('says only how long the cache lookup took when the colo has it', async () => {
        await env.DERIVED.put(`${derivedPrefix(testVersionId('v1'))}/200x200-webp`, 'webp bytes');
        const first = await call(path);
        await first.body?.cancel();
        const response = await call(path);
        await response.body?.cancel();

        expect(response.headers.get('x-derived')).toBe('cache-api-hit');
        expect(timingNames(response)).toStrictEqual(['cache', 'worker']);
    });
});

/** An Images binding that hands back the image it was given, whatever it is asked to make of it. */
function passingMetadataThrough(stream: ReadableStream<Uint8Array>): ImageTransformer {
    const transformer: ImageTransformer = {
        transform: () => transformer,
        draw: () => transformer,
        output: async () => ({
            response: () => new Response(stream),
            contentType: () => 'image/jpeg',
            image: () => stream,
        }),
    };
    return transformer;
}
