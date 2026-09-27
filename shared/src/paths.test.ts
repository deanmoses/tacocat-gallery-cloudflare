import { describe, expect, it } from 'vitest';
import {
    albumDate,
    albumKey,
    extensionOf,
    hasStrictExtension,
    hrefOf,
    isAlbumPath,
    isDayAlbumPath,
    isMediaName,
    isMediaPath,
    isStoredMediaName,
    isStrictMediaName,
    isYearAlbumPath,
    mediaKey,
    parentPathOf,
    parsePath,
    pathOfUrl,
    sanitizeMediaBaseName,
    sanitizeMediaFilename,
} from './paths.ts';

/** Local midnight on a date, which is what an album stands at. */
function day(year: number, month: number, dayOfMonth: number): Date {
    const date = new Date(0);
    date.setFullYear(year, month - 1, dayOfMonth);
    date.setHours(0, 0, 0, 0);
    return date;
}

describe(parsePath, () => {
    it.each([
        { path: '/', parsed: { kind: 'root' } },
        { path: '/2001/', parsed: { kind: 'year', parentPath: '/', name: '2001', date: day(2001, 1, 1) } },
        {
            path: '/2001/06-15/',
            parsed: { kind: 'day', parentPath: '/2001/', name: '06-15', date: day(2001, 6, 15) },
        },
        {
            path: '/2001/06-15/felix.jpg',
            parsed: { kind: 'media', parentPath: '/2001/06-15/', name: 'felix.jpg' },
        },
        {
            path: '/2001/06-15/Félix at the beach.JPG',
            parsed: { kind: 'media', parentPath: '/2001/06-15/', name: 'Félix at the beach.JPG' },
        },
        // A leap day exists only in a leap year.
        {
            path: '/2004/02-29/',
            parsed: { kind: 'day', parentPath: '/2004/', name: '02-29', date: day(2004, 2, 29) },
        },
        // A year below 100, which the Date constructor alone would read as the 1900s.
        { path: '/0050/', parsed: { kind: 'year', parentPath: '/', name: '0050', date: day(50, 1, 1) } },
    ])('reads $path', ({ path, parsed }) => {
        expect(parsePath(path)).toStrictEqual(parsed);
    });

    it.each([
        '',
        '2001/',
        '/2001',
        '/2001//',
        '/201/',
        '/20011/',
        '/abcd/',
        '/2001/06-15',
        '/2001/6-15/',
        '/2001/06-15/felix.jpg/',
        '/2001/06-15/x/felix.jpg',
        '/2001/felix.jpg',
        '/felix.jpg',
        '/2001/06-15/felix',
        // Days the calendar does not have.
        '/2001/02-29/',
        '/2001/02-30/',
        '/2001/13-01/',
        '/2001/00-10/',
        '/2001/06-00/',
        '/2001/06-31/',
        '/2001/12-32/',
    ])('reads %s as no path', (path) => {
        expect(parsePath(path)).toBeNull();
    });
});

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

describe(isYearAlbumPath, () => {
    it('accepts a year album and nothing else', () => {
        expect(isYearAlbumPath('/2001/')).toBe(true);
        expect(isYearAlbumPath('/2001/06-15/')).toBe(false);
        expect(isYearAlbumPath('/')).toBe(false);
    });
});

describe(isDayAlbumPath, () => {
    it('accepts a day album and nothing above it', () => {
        expect(isDayAlbumPath('/2001/06-15/')).toBe(true);
        expect(isDayAlbumPath('/2001/')).toBe(false);
        expect(isDayAlbumPath('/')).toBe(false);
    });

    it('refuses a day the calendar does not have', () => {
        expect(isDayAlbumPath('/2001/02-30/')).toBe(false);
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

describe(isStoredMediaName, () => {
    it.each(['felix.jpg', 'Félix at the beach.JPG', 'IMG_0001.HEIC', 'clip.mov'])('accepts %s', (name) => {
        expect(isStoredMediaName(name)).toBe(true);
    });

    it.each(['felix.jpeg', 'felix.JPEG', 'notes.txt', 'felix', 'a.b.jpg'])('rejects %s', (name) => {
        expect(isStoredMediaName(name)).toBe(false);
    });
});

describe(hasStrictExtension, () => {
    it.each(['felix.jpg', 'Old-Photo.png', 'IMG_0001.heic'])('accepts %s', (name) => {
        expect(hasStrictExtension(name)).toBe(true);
    });

    it.each(['felix.JPG', 'felix.jpeg', 'notes.txt', 'felix'])('rejects %s', (name) => {
        expect(hasStrictExtension(name)).toBe(false);
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
        'felix.jpeg',
        'notes.txt',
    ])('rejects %s', (name) => {
        expect(isStrictMediaName(name)).toBe(false);
    });
});

describe(sanitizeMediaBaseName, () => {
    it.each([
        { in: 'photo', out: 'photo' },
        { in: 'my_photo_1', out: 'my_photo_1' },
        { in: '123', out: '123' },
        { in: 'PHOTO', out: 'photo' },
        // Anything outside [a-z0-9_] becomes an underscore, and a run of them collapses to one
        { in: 'my photo', out: 'my_photo' },
        { in: 'my-photo', out: 'my_photo' },
        { in: 'my  photo', out: 'my_photo' },
        { in: 'my___photo', out: 'my_photo' },
        { in: 'my - photo', out: 'my_photo' },
        { in: "photo's", out: 'photo_s' },
        { in: 'photo@home', out: 'photo_home' },
        { in: '_photo', out: 'photo' },
        { in: '__photo', out: 'photo' },
        { in: '-photo', out: 'photo' },
        // A trailing underscore stays while a name is being typed; the strict rule refuses it on submit
        { in: 'photo_', out: 'photo_' },
        { in: 'photo-', out: 'photo_' },
        { in: '', out: '' },
    ])('[$in] sanitizes to [$out]', ({ in: name, out }) => {
        expect(sanitizeMediaBaseName(name)).toBe(out);
    });
});

describe(sanitizeMediaFilename, () => {
    it.each([
        { in: 'photo.jpg', out: 'photo.jpg' },
        { in: 'my_photo_1.jpg', out: 'my_photo_1.jpg' },
        // The name and the extension are both lowercased
        { in: 'IMAGE.JPG', out: 'image.jpg' },
        { in: 'Photo.PNG', out: 'photo.png' },
        { in: 'photo.GIF', out: 'photo.gif' },
        // jpeg is spelled jpg
        { in: 'photo.jpeg', out: 'photo.jpg' },
        { in: 'PHOTO.JPEG', out: 'photo.jpg' },
        { in: 'DSC_0001.jpeg', out: 'dsc_0001.jpg' },
        // Invalid characters become underscores, and runs collapse
        { in: 'my photo.jpg', out: 'my_photo.jpg' },
        { in: 'my--photo.jpg', out: 'my_photo.jpg' },
        { in: 'my - photo.jpg', out: 'my_photo.jpg' },
        { in: 'photo#1.jpg', out: 'photo_1.jpg' },
        { in: 'photo (1).jpg', out: 'photo_1.jpg' },
        { in: "photo's.jpg", out: 'photo_s.jpg' },
        // Underscores at either end of the name go, the trailing one included, unlike in a name being typed
        { in: '_photo.jpg', out: 'photo.jpg' },
        { in: '-photo.jpg', out: 'photo.jpg' },
        { in: 'photo_.jpg', out: 'photo.jpg' },
        { in: 'photo__.jpg', out: 'photo.jpg' },
        { in: 'photo-.jpg', out: 'photo.jpg' },
        { in: '123photo.jpg', out: '123photo.jpg' },
        // Only the last dot separates the extension, so earlier ones are sanitized as part of the name
        { in: 'Screenshot 2024-01-15 at 10.30.45 AM.png', out: 'screenshot_2024_01_15_at_10_30_45_am.png' },
        { in: 'Photo 2024-01-15.jpg', out: 'photo_2024_01_15.jpg' },
        // The extension is lowercased and jpeg respelled, and nothing else about it is touched, so a file the
        // gallery does not take is still refused by its name
        { in: 'photo.jpeg2000', out: 'photo.jpeg2000' },
        { in: 'photo.j pg', out: 'photo.j pg' },
        { in: 'notes.TXT', out: 'notes.txt' },
        // With no dot there is no extension to split off, so the whole string is a name
        { in: 'My Photo', out: 'my_photo' },
        { in: 'my photo_', out: 'my_photo_' },
        { in: '.jpg', out: '.jpg' },
        { in: 'photo.', out: 'photo.' },
        { in: '', out: '' },
    ])('[$in] sanitizes to [$out]', ({ in: fileName, out }) => {
        expect(sanitizeMediaFilename(fileName)).toBe(out);
    });

    it.each(['IMG_0001.HEIC', 'Félix at the beach.JPEG', 'my - clip (2).MOV', '__x__.png'])(
        'makes a strict name of %s, which presign and the tables then take',
        (fileName) => {
            expect(isStrictMediaName(sanitizeMediaFilename(fileName))).toBe(true);
        },
    );
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

describe(parentPathOf, () => {
    it.each([
        { path: '/2001/06-15/felix.jpg', parent: '/2001/06-15/' },
        { path: '/2001/06-15/', parent: '/2001/' },
        { path: '/2001/', parent: '/' },
    ])('$path is in $parent', ({ path, parent }) => {
        expect(parentPathOf(path)).toBe(parent);
    });

    it.each(['/', '/2001', 'nonsense', ''])('throws for %s, which has no parent', (path) => {
        expect(() => parentPathOf(path)).toThrow(`Not a path with a parent: [${path}]`);
    });
});

describe(albumDate, () => {
    it('stands a year album at its first day and a day album at its date', () => {
        expect(albumDate('/2001/')).toStrictEqual(day(2001, 1, 1));
        expect(albumDate('/2001/12-31/')).toStrictEqual(day(2001, 12, 31));
    });

    it.each(['/', '/2001/12-31/felix.jpg', '/2001/13-01/', '/2001', ''])('throws for %s', (path) => {
        expect(() => albumDate(path)).toThrow(`Not a year or day album: [${path}]`);
    });
});

describe(pathOfUrl, () => {
    it.each([
        { pathname: '/', path: '/' },
        { pathname: '/2001', path: '/2001/' },
        { pathname: '/2001/06-15', path: '/2001/06-15/' },
        { pathname: '/2001/06-15/felix.jpg', path: '/2001/06-15/felix.jpg' },
        // Deeper than any gallery path, so it comes back as it is and reads as no path.
        { pathname: '/2001/06-15/felix.jpg/crop', path: '/2001/06-15/felix.jpg/crop' },
    ])('$pathname names $path', ({ pathname, path }) => {
        expect(pathOfUrl(pathname)).toBe(path);
    });

    it.each(['/', '/2001/', '/2001/06-15/', '/2001/06-15/felix.jpg'])('is the inverse of hrefOf on %s', (path) => {
        expect(pathOfUrl(hrefOf(path))).toBe(path);
    });
});

describe(hrefOf, () => {
    it.each([
        { path: '/', href: '/' },
        { path: '/2001/', href: '/2001' },
        { path: '/2001/06-15/', href: '/2001/06-15' },
        { path: '/2001/06-15/felix.jpg', href: '/2001/06-15/felix.jpg' },
    ])('$path is at $href', ({ path, href }) => {
        expect(hrefOf(path)).toBe(href);
    });
});
