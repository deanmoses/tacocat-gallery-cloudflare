import { describe, expect, it } from 'vitest';
import { localSearchUrl, searchUrl } from './config';

describe(searchUrl, () => {
    it('carries the terms in the path and the rest in the query', () => {
        expect(searchUrl({ terms: 'cat & dog', oldestYear: 2001 }, 0, 10)).toBe(
            '/api/search/cat%20%26%20dog?oldest=2001&pageSize=10',
        );
    });
});

describe(localSearchUrl, () => {
    it('carries the page to return to as one query value, whatever characters its path holds', () => {
        const url = localSearchUrl({ terms: 'cat' }, '/2001/12-31/a&b?.jpg');

        expect(new URL(url, 'https://pix.example').searchParams.get('returnPath')).toBe('/2001/12-31/a&b?.jpg');
    });
});
