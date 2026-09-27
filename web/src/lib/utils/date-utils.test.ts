import { describe, expect, it } from 'vitest';
import { albumTitle } from './date-utils';

describe(albumTitle, () => {
    it('titles a year album by its year', () => {
        expect(albumTitle('/2001/')).toBe('2001');
        expect(albumTitle('/2001/', 'short')).toBe('2001');
    });

    it('titles a day album by its date, with the year unless asked for the short form', () => {
        const long = albumTitle('/2001/06-15/');
        const short = albumTitle('/2001/06-15/', 'short');

        expect(long).toBe(
            new Date(2001, 5, 15).toLocaleString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }),
        );
        expect(short).toBe(new Date(2001, 5, 15).toLocaleString(undefined, { month: 'short', day: 'numeric' }));
    });

    it.each(['/', '/2001/06-15/felix.jpg', '/2001/13-01/', 'nonsense'])('throws for %s', (path) => {
        expect(() => albumTitle(path)).toThrow(`Not a year or day album: [${path}]`);
    });
});
