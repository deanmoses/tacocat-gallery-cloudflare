import { describe, expect, inject, it } from 'vitest';

/**
 * The shell is where SvelteKit writes a service worker's registration, and a worker is easy to bring back by adding
 * `web/src/service-worker.ts`. The app has none on purpose: a browser starts an installed worker before every
 * navigation, and the one the app had precached every file of the build on a first visit, ahead of the album's
 * thumbnails, for a cache it never read.
 */
describe('the app shell', () => {
    it('registers no service worker', async () => {
        const response = await fetch(new URL('/2001/06-15', inject('stackOrigin')), {
            headers: { 'sec-fetch-mode': 'navigate' },
        });
        const shell = await response.text();

        expect(response.status).toBe(200);
        expect(shell).toContain('<!doctype html>');
        expect(shell).not.toContain('serviceWorker');
    });
});
