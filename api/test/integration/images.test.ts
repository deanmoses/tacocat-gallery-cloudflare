import { env } from 'cloudflare:workers';
import { imageUrl } from '@tacocat-gallery/shared';
import { describe, expect, it } from 'vitest';
import { derivedPrefix } from '../../src/storage/keys';
import { call } from '../helpers';
import { testVersionId } from '../version-id';

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
