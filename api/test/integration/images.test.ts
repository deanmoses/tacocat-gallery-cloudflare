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
