import { describe, expect, it } from 'vitest';
import { albumUrl, itemUrl, localSearchUrl, searchUrl } from './config';

/**
 * The API is reached on the site's own domain, so every API URL is a path.
 * A host here would make the API cross-origin, with CORS and credentials to
 * get right, and would bypass the edge cache in front of /api/.
 */
describe('API URLs', () => {
    it.each([
        { url: albumUrl('/'), path: '/api/album/' },
        { url: albumUrl('/2001/12-31/'), path: '/api/album/2001/12-31' },
        { url: searchUrl({ terms: 'cat' }, 0, 10), path: '/api/search/cat' },
    ])('$path is on this origin', ({ url, path }) => {
        expect(url.startsWith(path)).toBe(true);
    });
});

describe(itemUrl, () => {
    it('names a media item under media and an album under album', () => {
        expect(itemUrl('/2001/12-31/felix')).toBe('/api/media/2001/12-31/felix');
        expect(itemUrl('/2001/12-31/')).toBe('/api/album/2001/12-31/');
    });
});

describe(localSearchUrl, () => {
    it('carries the page to return to as one query value, whatever characters its path holds', () => {
        const url = localSearchUrl({ terms: 'cat' }, '/2001/12-31/a&b?.jpg');

        expect(new URL(url, 'https://pix.example').searchParams.get('returnPath')).toBe('/2001/12-31/a&b?.jpg');
    });
});
