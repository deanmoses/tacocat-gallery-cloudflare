import { describe, expect, it } from 'vitest';
import { albumKey, albumsEnclosing, isAlbumPath } from './paths';

describe(isAlbumPath, () => {
    it.each(['/', '/2001/', '/2001/06-15/'])('accepts %s', (path) => {
        expect(isAlbumPath(path)).toBe(true);
    });

    it.each(['', '2001/', '/2001', '/2001/06-15', '/2001/06-15/felix.jpg', '/20011/', '/2001/6-15/', '/2001/06-15/x/'])(
        'rejects %s',
        (path) => {
            expect(isAlbumPath(path)).toBe(false);
        },
    );
});

describe(albumKey, () => {
    it('splits a day album into its year and its name', () => {
        expect(albumKey('/2001/06-15/')).toStrictEqual({ parentPath: '/2001/', itemName: '06-15' });
    });

    it('puts a year album under the root', () => {
        expect(albumKey('/2001/')).toStrictEqual({ parentPath: '/', itemName: '2001' });
    });

    it('gives the root no key', () => {
        expect(albumKey('/')).toBeNull();
    });
});

describe(albumsEnclosing, () => {
    it('lists the year then the day for a day album', () => {
        expect(albumsEnclosing('/2001/06-15/')).toStrictEqual([
            { parentPath: '/', itemName: '2001' },
            { parentPath: '/2001/', itemName: '06-15' },
        ]);
    });

    it('lists nothing for the root or for something that is not an album', () => {
        expect(albumsEnclosing('/')).toStrictEqual([]);
        expect(albumsEnclosing('/ryw/')).toStrictEqual([]);
    });
});
