import { readdir } from 'node:fs/promises';
import { describe, expect, inject, it } from 'vitest';

/**
 * Which requests reach the Worker and which get the web app's files, decided by the asset router from `assets` in
 * wrangler.jsonc. Every request is sent as a browser navigation, since for a navigation the router serves the app's
 * index.html unless the path is listed as the Worker's. Only the Worker sets x-worker-colo.
 */
async function navigate(path: string, method = 'GET'): Promise<Response> {
    return fetch(new URL(path, inject('stackOrigin')), { method, headers: { 'sec-fetch-mode': 'navigate' } });
}

describe('the asset router', () => {
    it.each([
        ['GET', '/api/auth/status'],
        ['GET', '/login'],
        ['GET', '/invite/abc'],
        ['GET', '/raw/2001/01-01/a.jpg/v1'],
        ['GET', '/v/2001/01-01/a.mp4/v1'],
        ['GET', '/i/2001/01-01/a.jpg/v1'],
        ['GET', '/i2/2001/01-01/a.jpg/v1'],
        ['GET', '/debug/image/2001/01-01/a.jpg'],
        ['PUT', '/upload/v1'],
    ])('sends %s %s to the Worker', async (method, path) => {
        const response = await navigate(path, method);
        await response.body?.cancel();

        expect(response.headers.has('x-worker-colo')).toBe(true);
    });

    it.each(['/', '/2001', '/2001/', '/2001/06-15', '/2001/06-15/felix.jpg', '/search/tacos'])(
        'serves the web app for %s',
        async (path) => {
            const response = await navigate(path);
            const body = await response.text();

            expect(response.status).toBe(200);
            expect(response.headers.has('x-worker-colo')).toBe(false);
            expect(body).toContain('<meta name="robots" content="noindex" />');
        },
    );
});

describe('preloading the album JSON', () => {
    const preload = (path: string): string => `<${path}>; rel=preload; as=fetch; crossorigin`;
    const album = preload('/api/album/2001/06-15/');
    const year = preload('/api/album/2001/');

    it.each([
        ['a day album', '/2001/06-15', [album, year]],
        ['a day album with a trailing slash', '/2001/06-15/', [album, year]],
        ['a photo', '/2001/06-15/felix.jpg', [album]],
    ])(
        'names the JSON %s needs in the page headers, so the browser asks before the app runs',
        async (_what, path, links) => {
            const response = await navigate(path);
            await response.body?.cancel();

            expect(response.headers.get('link')).toBe(links.join(', '));
        },
    );

    it.each(['/', '/2001', '/2001/', '/search', '/search/tacos', '/robots.txt'])(
        'preloads nothing for %s',
        async (path) => {
            const response = await navigate(path);
            await response.body?.cancel();

            expect(response.headers.has('link')).toBe(false);
        },
    );
});

describe('browser caching of the web app', () => {
    it('lets a browser keep a hashed app chunk for a year without asking the server again', async () => {
        const entries = await readdir(new URL('../../../web/build/_app/immutable/entry/', import.meta.url));
        const chunk = entries.find((name) => name.endsWith('.js'));
        const response = await fetch(new URL(`/_app/immutable/entry/${chunk ?? ''}`, inject('stackOrigin')));
        await response.body?.cancel();

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    });

    it('has a browser check the app page itself on every visit, since a deploy changes it at the same URL', async () => {
        const response = await navigate('/2001/06-15');
        await response.body?.cancel();

        expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    });
});
