import { readdir } from 'node:fs/promises';
import { describe, expect, inject, it } from 'vitest';
import { SITE_HEADERS } from '../../src/http/headers.ts';

/**
 * The app's files come from the asset router, never the Worker, so their headers come from web/static/_headers. These
 * hold that file to the same values the Worker sends, and check robots.txt is the file and not the app's fallback.
 */
async function navigate(path: string): Promise<Response> {
    return fetch(new URL(path, inject('stackOrigin')), { headers: { 'sec-fetch-mode': 'navigate' } });
}

function headersOf(response: Response): Record<string, string | null> {
    return Object.fromEntries(Object.keys(SITE_HEADERS).map((name) => [name, response.headers.get(name)]));
}

describe("the site's headers on the app's files", () => {
    it.each([
        ['the app shell', '/'],
        ["an app route's fallback", '/2001/06-15'],
        ['robots.txt', '/robots.txt'],
    ])('are on %s, the same as the Worker sends', async (_what, path) => {
        const response = await navigate(path);
        await response.body?.cancel();

        expect(response.headers.has('x-worker-colo')).toBe(false);
        expect(headersOf(response)).toStrictEqual(SITE_HEADERS);
    });

    it('are on a hashed app chunk, beside its year-long cache rule', async () => {
        const entries = await readdir(new URL('../../../web/build/_app/immutable/entry/', import.meta.url));
        const chunk = entries.find((name) => name.endsWith('.js'));
        const response = await fetch(new URL(`/_app/immutable/entry/${chunk ?? ''}`, inject('stackOrigin')));
        await response.body?.cancel();

        expect(headersOf(response)).toStrictEqual(SITE_HEADERS);
        expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    });
});

describe('robots.txt', () => {
    it('lets every crawler in, so it sees the noindex, and keeps the training bots out', async () => {
        const response = await navigate('/robots.txt');
        const body = await response.text();

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/plain');
        expect(body).toMatch(/^(?:#[^\n]*\n)*User-agent: \*\nAllow: \/\n{2}(?:User-agent: [^\n]+\n)+Disallow: \/\n$/v);
        expect(body).toContain('User-agent: GPTBot\n');
        expect(body).toContain('User-agent: ClaudeBot\n');
    });
});
