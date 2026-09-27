import { describe, expect, it } from 'vitest';
import { sameSitePath } from './returnPath';

const ORIGIN = 'https://pix.example';

describe(sameSitePath, () => {
    it.each([
        { name: 'no parameter', value: null, path: '/' },
        { name: 'an album', value: '/2001/06-15', path: '/2001/06-15' },
        { name: 'a search', value: '/search/tacos?returnPath=%2F', path: '/search/tacos?returnPath=%2F' },
        { name: 'another site', value: 'https://evil.example/2001', path: '/' },
        { name: 'a protocol-relative URL', value: '//evil.example/2001', path: '/' },
        { name: 'a backslash browsers read as a slash', value: String.raw`/\evil.example/2001`, path: '/' },
        { name: 'a data URL', value: 'data:text/html,hi', path: '/' },
    ])('returns $path for $name', ({ value, path }) => {
        expect(sameSitePath(value, ORIGIN)).toBe(path);
    });
});
