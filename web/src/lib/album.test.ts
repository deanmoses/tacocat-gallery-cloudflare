import { isHttpError } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { albumTitle, loadAlbum } from './album';
import { album } from './test-support/fixtures';

describe(loadAlbum, () => {
    it('asks the Worker for the album and hands back what it parsed', async () => {
        const asked: string[] = [];
        const fetch: typeof globalThis.fetch = async (input) => {
            asked.push(input instanceof Request ? input.url : String(input));
            return Response.json(album('/2001/06-15/'));
        };
        const loaded = await loadAlbum(fetch, '/2001/06-15/');

        expect(asked).toStrictEqual(['/api/album/2001/06-15/']);
        expect(loaded.path).toBe('/2001/06-15/');
    });

    it('turns a 404 into a not-found page', async () => {
        const fetch: typeof globalThis.fetch = async () => new Response(null, { status: 404 });

        await expect(loadAlbum(fetch, '/2001/06-15/')).rejects.toSatisfy((thrown) => isHttpError(thrown, 404));
    });

    it('refuses a body that is not an album', async () => {
        const fetch: typeof globalThis.fetch = async () => Response.json({ path: '/2001/' });

        await expect(loadAlbum(fetch, '/2001/')).rejects.toThrow(/^Invalid (?:key|type)/v);
    });
});

describe(albumTitle, () => {
    it.each([
        ['/', 'Tacocat Gallery'],
        ['/2001/', '2001'],
        ['/2001/06-15/', 'June 15, 2001'],
    ])('names %s from its path: %s', (path, title) => {
        expect(albumTitle({ path, title: null })).toBe(title);
    });

    it('prefers the title the album has', () => {
        expect(albumTitle({ path: '/2001/06-15/', title: 'Felix' })).toBe('Felix');
    });
});
