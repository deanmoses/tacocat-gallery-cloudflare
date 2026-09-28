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
    ])('are on %s', async (_what, path) => {
        const response = await call(path);
        await response.body?.cancel();

        expect(headersOf(response, SITE_HEADERS)).toStrictEqual(SITE_HEADERS);
    });

    it('are on an image, with the one that keeps other sites from embedding it', async () => {
        const path = imageUrl({
            path: '/2001/01-01/a',
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

    it.each(['/raw/2001/01-01/a', '/v/2001/01-01/a'])(
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

describe('caching of what the Worker answers', () => {
    it.each([
        { name: 'whether an admin is logged in', path: '/api/auth/status', method: 'GET' },
        { name: 'a search, which an admin sees more of', path: '/api/search/cat', method: 'GET' },
        { name: 'the health check', path: '/api/health', method: 'GET' },
        { name: 'a route that is not there', path: '/api/nothing', method: 'GET' },
        { name: 'an album that is not there', path: '/api/album/1999/', method: 'GET' },
        { name: 'a photo whose original is not there', path: '/raw/2001/01-01/a/v1', method: 'GET' },
        { name: 'a write from someone not logged in', path: '/api/album/2001/', method: 'PUT' },
    ])('has a browser ask again before reusing $name, and no shared cache keep it', async ({ path, method }) => {
        const response = await call(path, { method });
        await response.body?.cancel();

        expect(response.headers.get('cache-control')).toBe('private, no-cache');
    });
});
