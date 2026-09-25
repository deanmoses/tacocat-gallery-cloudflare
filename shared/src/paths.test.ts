import { describe, expect, it } from 'vitest';
import {
    albumKey,
    albumsEnclosing,
    extensionOf,
    isAlbumPath,
    isDayAlbumPath,
    isMediaName,
    isMediaPath,
    isStrictMediaName,
    mediaKey,
} from './paths';

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

describe(isDayAlbumPath, () => {
    it('accepts a day album and nothing above it', () => {
        expect(isDayAlbumPath('/2001/06-15/')).toBe(true);
        expect(isDayAlbumPath('/2001/')).toBe(false);
        expect(isDayAlbumPath('/')).toBe(false);
    });
});

describe(isMediaName, () => {
    it.each(['felix.jpg', 'IMG_0001.HEIC', 'clip.mov'])('accepts %s', (name) => {
        expect(isMediaName(name)).toBe(true);
    });

    it.each(['', 'felix', '.jpg', 'felix.', 'a.b.jpg', 'dir/felix.jpg', '06-15'])('rejects %s', (name) => {
        expect(isMediaName(name)).toBe(false);
    });
});

describe(isStrictMediaName, () => {
    it.each(['felix.jpg', 'img_0001.heic', 'a1_b2_c3.mov'])('accepts %s', (name) => {
        expect(isStrictMediaName(name)).toBe(true);
    });

    it.each([
        'Felix.jpg',
        'felix.JPG',
        'felix-1.jpg',
        'felix__1.jpg',
        '_felix.jpg',
        'felix_.jpg',
        'felix',
        'a.b.jpg',
        'félix.jpg',
    ])('rejects %s', (name) => {
        expect(isStrictMediaName(name)).toBe(false);
    });
});

describe(extensionOf, () => {
    it('is lowercase and without the dot', () => {
        expect(extensionOf('IMG_0001.HEIC')).toBe('heic');
    });
});

describe(isMediaPath, () => {
    it('accepts a file in a day album', () => {
        expect(isMediaPath('/2001/06-15/felix.jpg')).toBe(true);
    });

    it.each(['/2001/06-15/', '/2001/felix.jpg', '/felix.jpg', '/2001/06-15/felix', 'felix.jpg'])(
        'rejects %s',
        (path) => {
            expect(isMediaPath(path)).toBe(false);
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

describe(mediaKey, () => {
    it('splits a media path into its album and its name', () => {
        expect(mediaKey('/2001/06-15/felix.jpg')).toStrictEqual({ parentPath: '/2001/06-15/', itemName: 'felix.jpg' });
    });

    it.each(['/2001/06-15/', 'felix.jpg', '/2001/felix.jpg', '/2001/06-15/notes'])('gives %s no key', (path) => {
        expect(mediaKey(path)).toBeNull();
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
