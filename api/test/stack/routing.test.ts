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
        ['GET', '/upload-test'],
        ['PUT', '/upload/2001/01-01/a.jpg'],
        ['GET', '/raw/2001/01-01/a.jpg'],
        ['GET', '/v/2001/01-01/a.mp4'],
        ['GET', '/i/2001/01-01/a.jpg/v1'],
        ['GET', '/i2/2001/01-01/a.jpg/v1'],
        ['GET', '/debug/image/2001/01-01/a.jpg'],
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
