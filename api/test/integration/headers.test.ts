import { env } from 'cloudflare:workers';
import { imageUrl } from 'tacocat-gallery-shared';
import { describe, expect, it } from 'vitest';
import { MEDIA_HEADERS, SITE_HEADERS } from '../../src/http/headers';
import { derivedPrefix } from '../../src/storage/keys';
import { call } from '../helpers';

/** The response's values for the headers named in `expected`, keyed as `expected` is. */
function headersOf(response: Response, expected: Record<string, string>): Record<string, string | null> {
    return Object.fromEntries(Object.keys(expected).map((name) => [name, response.headers.get(name)]));
}

describe("the site's headers", () => {
    it.each([
        ['an API response', '/api/health'],
        ['a failure', '/api/nothing'],
        ['the login page', '/login'],
    ])('are on %s', async (_what, path) => {
        const response = await call(path);
        await response.body?.cancel();

        expect(headersOf(response, SITE_HEADERS)).toStrictEqual(SITE_HEADERS);
    });

    it('are on an image, with the one that keeps other sites from embedding it', async () => {
        const path = imageUrl({
            path: '/2001/01-01/a.jpg',
            versionId: 'v1',
            size: { width: 200, height: 200 },
            crop: null,
        });
        await env.DERIVED.put(`${derivedPrefix('v1')}/200x200-webp`, 'webp bytes');

        const response = await call(path);
        await response.body?.cancel();

        expect(headersOf(response, { ...SITE_HEADERS, ...MEDIA_HEADERS })).toStrictEqual({
            ...SITE_HEADERS,
            ...MEDIA_HEADERS,
        });
    });

    it.each(['/raw/2001/01-01/a.jpg', '/v/2001/01-01/a.mp4', '/i2/2001/01-01/a.jpg/v1'])(
        'keep other sites from embedding what %s serves, even when it is missing',
        async (path) => {
            const response = await call(path);
            await response.body?.cancel();

            expect(headersOf(response, MEDIA_HEADERS)).toStrictEqual(MEDIA_HEADERS);
        },
    );

    it('do not stop the app itself reading the API', async () => {
        const response = await call('/api/health');
        await response.body?.cancel();

        expect(response.headers.has('cross-origin-resource-policy')).toBe(false);
    });
});
