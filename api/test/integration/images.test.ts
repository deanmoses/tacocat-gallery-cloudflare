import { env } from 'cloudflare:workers';
import { imageUrl } from 'tacocat-gallery-shared';
import { describe, expect, it, vi } from 'vitest';
import { derivedPrefix } from '../../src/storage/keys';
import { call } from '../helpers';

describe('derived images through the CDN', () => {
    it("fetches the derivative from the environment's derived-image host", async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(
                new Response('webp bytes', { headers: { 'content-type': 'image/webp', 'cf-cache-status': 'HIT' } }),
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
        expect(fetched).toBe(`${env.DERIVED_ORIGIN}/${derivedPrefix('v1')}/200x200-webp`);
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
        await env.DERIVED.put(`${derivedPrefix('v1')}/200x200-webp`, 'webp bytes');
        const response = await call(path);
        await response.body?.cancel();

        expect(response.headers.get('x-derived')).toBe('stored');
        expect(timingNames(response)).toStrictEqual(['cache', 'r2', 'worker']);
    });

    // What each browser sends for an <img>: only the old one lacks image/webp.
    const CHROME = { accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' };
    const OLD_SAFARI = { accept: 'image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5' };

    it('serves WebP to a browser that accepts it and JPEG to one that does not, from one URL', async () => {
        await env.DERIVED.put(`${derivedPrefix('v1')}/200x200-webp`, 'webp bytes');
        await env.DERIVED.put(`${derivedPrefix('v1')}/200x200-jpeg`, 'jpeg bytes');
        const modern = await call(path, { headers: CHROME });
        const old = await call(path, { headers: OLD_SAFARI });

        expect([modern.headers.get('content-type'), await modern.text()]).toStrictEqual(['image/webp', 'webp bytes']);
        expect([old.headers.get('content-type'), await old.text()]).toStrictEqual(['image/jpeg', 'jpeg bytes']);
        expect(modern.headers.get('vary')).toBe('Accept');
    });

    it('keeps the two formats apart in the cache, so the first browser does not decide for the next', async () => {
        await env.DERIVED.put(`${derivedPrefix('v1')}/200x200-webp`, 'webp bytes');
        await env.DERIVED.put(`${derivedPrefix('v1')}/200x200-jpeg`, 'jpeg bytes');
        const first = await call(path, { headers: CHROME });
        await first.body?.cancel();
        const old = await call(path, { headers: OLD_SAFARI });
        const modernAgain = await call(path, { headers: CHROME });

        expect([old.headers.get('x-derived'), await old.text()]).toStrictEqual(['stored', 'jpeg bytes']);
        expect([modernAgain.headers.get('x-derived'), await modernAgain.text()]).toStrictEqual([
            'cache-api-hit',
            'webp bytes',
        ]);
    });

    it('says only how long the cache lookup took when the colo has it', async () => {
        await env.DERIVED.put(`${derivedPrefix('v1')}/200x200-webp`, 'webp bytes');
        const first = await call(path);
        await first.body?.cancel();
        const response = await call(path);
        await response.body?.cancel();

        expect(response.headers.get('x-derived')).toBe('cache-api-hit');
        expect(timingNames(response)).toStrictEqual(['cache', 'worker']);
    });
});
