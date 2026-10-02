import { describe, expect, it } from 'vitest';
import {
    IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS,
    albumDate,
    albumKey,
    contentTypeOf,
    deduplicateNames,
    extensionForType,
    extensionOf,
    hrefOf,
    isAlbumPath,
    isDayAlbumPath,
    isHeicFile,
    isMediaName,
    isMediaPath,
    isVideoFile,
    isYearAlbumPath,
    mediaKey,
    parentPathOf,
    parsePath,
    pathOfUrl,
    sanitizeMediaName,
    sanitizeMediaNameAsTyped,
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
        { path: '/2001/06-15/felix', parsed: { kind: 'media', parentPath: '/2001/06-15/', name: 'felix' } },
        {
            path: '/2001/06-15/img_0001_2',
            parsed: { kind: 'media', parentPath: '/2001/06-15/', name: 'img_0001_2' },
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
        '/2001/06-15/felix/',
        '/2001/06-15/x/felix',
        '/2001/felix',
        '/felix',
        // Names the rule refuses: an extension, a capital, a hyphen, a space, an accent.
        '/2001/06-15/felix.jpg',
        '/2001/06-15/Felix',
        '/2001/06-15/felix-1',
        '/2001/06-15/felix beach',
        '/2001/06-15/félix',
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

    it.each(['', '2001/', '/2001', '/2001/06-15', '/2001/06-15/felix', '/20011/', '/2001/6-15/', '/2001/06-15/x/'])(
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
    it.each(['felix', 'img_0001', 'a1_b2_c3', '2024', 'x'])('accepts %s', (name) => {
        expect(isMediaName(name)).toBe(true);
    });

    it.each([
        '',
        'felix.jpg',
        'Felix',
        'felix-1',
        'felix__1',
        '_felix',
        'felix_',
        'félix',
        'felix beach',
        'dir/felix',
        '06-15',
    ])('rejects %s', (name) => {
        expect(isMediaName(name)).toBe(false);
    });
});

describe(sanitizeMediaNameAsTyped, () => {
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
        { in: 'félix', out: 'f_lix' },
        { in: '_photo', out: 'photo' },
        { in: '__photo', out: 'photo' },
        { in: '-photo', out: 'photo' },
        // A trailing underscore stays while a name is being typed; the name rule refuses it on submit
        { in: 'photo_', out: 'photo_' },
        { in: 'photo-', out: 'photo_' },
        { in: '', out: '' },
    ])('[$in] sanitizes to [$out]', ({ in: name, out }) => {
        expect(sanitizeMediaNameAsTyped(name)).toBe(out);
    });
});

describe(sanitizeMediaName, () => {
    it.each([
        { in: 'photo.jpg', out: 'photo' },
        { in: 'my_photo_1.jpg', out: 'my_photo_1' },
        { in: 'IMAGE.JPG', out: 'image' },
        { in: 'IMG_0001.HEIC', out: 'img_0001' },
        { in: 'DSC_0001.jpeg', out: 'dsc_0001' },
        { in: 'clip.MOV', out: 'clip' },
        // Invalid characters become underscores, and runs collapse
        { in: 'my photo.jpg', out: 'my_photo' },
        { in: 'my--photo.jpg', out: 'my_photo' },
        { in: 'my - photo.jpg', out: 'my_photo' },
        { in: 'photo#1.jpg', out: 'photo_1' },
        { in: 'photo (1).jpg', out: 'photo_1' },
        { in: "photo's.jpg", out: 'photo_s' },
        // Underscores at either end of the name go, the trailing one included, unlike in a name being typed
        { in: '_photo.jpg', out: 'photo' },
        { in: '-photo.jpg', out: 'photo' },
        { in: 'photo_.jpg', out: 'photo' },
        { in: 'photo__.jpg', out: 'photo' },
        { in: 'photo-.jpg', out: 'photo' },
        { in: '123photo.jpg', out: '123photo' },
        // Only the last dot separates the extension, so earlier ones are sanitized as part of the name
        { in: 'Screenshot 2024-01-15 at 10.30.45 AM.png', out: 'screenshot_2024_01_15_at_10_30_45_am' },
        { in: 'Photo 2024-01-15.jpg', out: 'photo_2024_01_15' },
        // With no dot there is no extension to drop, so the whole string is the name
        { in: 'My Photo', out: 'my_photo' },
        { in: 'my photo_', out: 'my_photo' },
        // Nothing before the dot is nothing, which the name rule then refuses
        { in: '.jpg', out: '' },
        { in: '', out: '' },
    ])('[$in] sanitizes to [$out]', ({ in: fileName, out }) => {
        expect(sanitizeMediaName(fileName)).toBe(out);
    });

    it.each(['IMG_0001.HEIC', 'Félix at the beach.JPEG', 'my - clip (2).MOV', '__x__.png'])(
        'makes a media name of %s, which presign and the tables then take',
        (fileName) => {
            expect(isMediaName(sanitizeMediaName(fileName))).toBe(true);
        },
    );
});

describe(deduplicateNames, () => {
    it.each([
        { description: 'nothing to do', in: [], out: [] },
        { description: 'no repeats', in: ['a', 'b'], out: ['a', 'b'] },
        { description: 'one repeat', in: ['a', 'a'], out: ['a', 'a_2'] },
        { description: 'three of one name', in: ['a', 'a', 'a'], out: ['a', 'a_2', 'a_3'] },
        // A name a suffix would land on is taken wherever it stands, so the suffix skips it
        { description: 'a suffix already in the list', in: ['a', 'a', 'a_2'], out: ['a', 'a_3', 'a_2'] },
        { description: 'a suffix later in the list', in: ['a_2', 'a', 'a'], out: ['a_2', 'a', 'a_3'] },
        // The order is kept
        { description: 'repeats apart', in: ['a', 'b', 'a', 'b'], out: ['a', 'b', 'a_2', 'b_2'] },
    ])('$description: $in becomes $out', ({ in: names, out }) => {
        expect(deduplicateNames(names)).toStrictEqual(out);
    });

    it('produces no repeats, whatever it is given', () => {
        const names = ['x', 'x', 'x_2', 'x', 'x_3', 'x_2', 'y'];

        expect(new Set(deduplicateNames(names)).size).toBe(names.length);
    });
});

describe(isVideoFile, () => {
    it('reads the extension of a file name, in either case', () => {
        expect(['clip.mov', 'clip.MP4', 'photo.jpg', 'photo.HEIC', 'notes'].map(isVideoFile)).toStrictEqual([
            true,
            true,
            false,
            false,
            false,
        ]);
    });
});

describe(isHeicFile, () => {
    it('reads the extension of a file name, in either case', () => {
        expect(['photo.heic', 'photo.HEIF', 'photo.jpg', 'clip.mov'].map(isHeicFile)).toStrictEqual([
            true,
            true,
            false,
            false,
        ]);
    });
});

describe(extensionOf, () => {
    it('is lowercase and without the dot', () => {
        expect(extensionOf('IMG_0001.HEIC')).toBe('heic');
    });
});

describe(contentTypeOf, () => {
    it.each([
        { extension: 'jpg', type: 'image/jpeg' },
        { extension: 'jpeg', type: 'image/jpeg' },
        { extension: 'heic', type: 'image/heic' },
        { extension: 'mov', type: 'video/quicktime' },
        { extension: 'JPG', type: null },
        { extension: 'pdf', type: null },
        { extension: 'toString', type: null },
        { extension: '', type: null },
    ])('says $type for $extension', ({ extension, type }) => {
        expect(contentTypeOf(extension)).toBe(type);
    });

    it('has a type for every extension an upload may have', () => {
        expect([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS].map(contentTypeOf)).not.toContain(null);
    });
});

describe(extensionForType, () => {
    it.each([
        { type: 'image/jpeg', extension: 'jpg' },
        { type: 'video/mpeg', extension: 'mpg' },
        { type: 'image/heif', extension: 'heif' },
        { type: 'application/octet-stream', extension: 'bin' },
    ])('names a download of $type .$extension', ({ type, extension }) => {
        expect(extensionForType(type)).toBe(extension);
    });
});

describe(isMediaPath, () => {
    it('accepts a media name in a day album', () => {
        expect(isMediaPath('/2001/06-15/felix')).toBe(true);
    });

    it.each(['/2001/06-15/', '/2001/felix', '/felix', '/2001/06-15/felix.jpg', 'felix'])('rejects %s', (path) => {
        expect(isMediaPath(path)).toBe(false);
    });
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
        expect(mediaKey('/2001/06-15/felix')).toStrictEqual({ parentPath: '/2001/06-15/', itemName: 'felix' });
    });

    it.each(['/2001/06-15/', 'felix', '/2001/felix', '/2001/06-15/Felix'])('gives %s no key', (path) => {
        expect(mediaKey(path)).toBeNull();
    });
});

describe(parentPathOf, () => {
    it.each([
        { path: '/2001/06-15/felix', parent: '/2001/06-15/' },
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

    it.each(['/', '/2001/12-31/felix', '/2001/13-01/', '/2001', ''])('throws for %s', (path) => {
        expect(() => albumDate(path)).toThrow(`Not a year or day album: [${path}]`);
    });
});

describe(pathOfUrl, () => {
    it.each([
        { pathname: '/', path: '/' },
        { pathname: '/2001', path: '/2001/' },
        { pathname: '/2001/06-15', path: '/2001/06-15/' },
        { pathname: '/2001/06-15/felix', path: '/2001/06-15/felix' },
        // Deeper than any gallery path, so it comes back as it is and reads as no path.
        { pathname: '/2001/06-15/felix/crop', path: '/2001/06-15/felix/crop' },
    ])('$pathname names $path', ({ pathname, path }) => {
        expect(pathOfUrl(pathname)).toBe(path);
    });

    it.each(['/', '/2001/', '/2001/06-15/', '/2001/06-15/felix'])('is the inverse of hrefOf on %s', (path) => {
        expect(pathOfUrl(hrefOf(path))).toBe(path);
    });
});

describe(hrefOf, () => {
    it.each([
        { path: '/', href: '/' },
        { path: '/2001/', href: '/2001' },
        { path: '/2001/06-15/', href: '/2001/06-15' },
        { path: '/2001/06-15/felix', href: '/2001/06-15/felix' },
    ])('$path is at $href', ({ path, href }) => {
        expect(hrefOf(path)).toBe(href);
    });
});
