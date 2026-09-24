import { env } from 'cloudflare:workers';
import { derivedPrefix, imageUrl } from 'tacocat-gallery-shared';
import { describe, expect, it, vi } from 'vitest';
import { call } from '../helpers';

describe('derived images through the CDN', () => {
    it("fetches the derivative from the environment's derived-image host", async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(
                new Response('jpeg bytes', { headers: { 'content-type': 'image/jpeg', 'cf-cache-status': 'HIT' } }),
            );
        const path = imageUrl({
            path: '/2001/01-01/a.jpg',
            versionId: 'v1',
            size: { width: 200, height: 200 },
            crop: null,
        });
        const response = await call(path.replace('/i/', '/i2/'));
        const [fetched] = fetchSpy.mock.calls[0] ?? [];

        expect(response.status).toBe(200);
        expect(response.headers.get('x-derived')).toBe('cdn-hit');
        expect(fetched).toBe(`${env.DERIVED_ORIGIN}/${derivedPrefix('/2001/01-01/a.jpg', 'v1')}/200x200-jpeg`);
    });
});

describe('derived images through the Cache API', () => {
    const path = imageUrl({
        path: '/2001/01-01/a.jpg',
        versionId: 'v1',
        size: { width: 200, height: 200 },
        crop: null,
    });

    /** The Server-Timing metric names, in order, without their durations. */
    function timingNames(response: Response): string[] {
        return (response.headers.get('server-timing') ?? '')
            .split(',')
            .map((metric) => metric.trim().split(';', 1)[0] ?? '');
    }

    it('says how long the cache lookup and the R2 read took when the colo misses', async () => {
        await env.DERIVED.put(`${derivedPrefix('/2001/01-01/a.jpg', 'v1')}/200x200-jpeg`, 'jpeg bytes');
        const response = await call(path);
        await response.body?.cancel();

        expect(response.headers.get('x-derived')).toBe('stored');
        expect(timingNames(response)).toStrictEqual(['cache', 'r2', 'worker']);
    });

    it('says only how long the cache lookup took when the colo has it', async () => {
        await env.DERIVED.put(`${derivedPrefix('/2001/01-01/a.jpg', 'v1')}/200x200-jpeg`, 'jpeg bytes');
        const first = await call(path);
        await first.body?.cancel();
        const response = await call(path);
        await response.body?.cancel();

        expect(response.headers.get('x-derived')).toBe('cache-api-hit');
        expect(timingNames(response)).toStrictEqual(['cache', 'worker']);
    });
});
