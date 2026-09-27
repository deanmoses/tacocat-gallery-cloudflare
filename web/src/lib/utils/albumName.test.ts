import { describe, expect, it } from 'vitest';
import { sanitizeAlbumName } from './albumName';

describe(sanitizeAlbumName, () => {
    it.each([
        // Already valid names survive untouched
        { in: '12-31', out: '12-31' },
        { in: '01-01', out: '01-01' },
        { in: '2001', out: '2001' },

        // Separators of any kind become the one hyphen the name allows
        { in: '12/31', out: '12-31' },
        { in: '12 31', out: '12-31' },
        { in: '12.31', out: '12-31' },
        { in: '12--31', out: '12-31' },

        // Letters are dropped outright rather than replaced, so a month name
        // takes its separator with it and leaves only the day
        { in: 'Dec 31', out: '31' },
        { in: 'december-31', out: '31' },
        // and letters between digits leave the digits fused, rather than
        // separated by the hyphen every other invalid character becomes
        { in: '12dec31', out: '1231' },

        // A leading separator is removed; a trailing one is left for the
        // validator to reject, so that typing a hyphen mid-name is possible
        { in: '-12-31', out: '12-31' },
        { in: '12-31-', out: '12-31-' },

        { in: '', out: '' },
    ])('[$in] sanitizes to [$out]', ({ in: albumName, out }) => {
        expect(sanitizeAlbumName(albumName)).toBe(out);
    });
});
