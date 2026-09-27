import { describe, expect, it } from 'vitest';
import {
    IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS,
    deduplicateMediaPaths,
    hasValidMediaExtension,
    isValidMediaNameWithoutExtensionStrict,
    sanitizeAlbumName,
    validMediaExtensionsString,
} from './galleryPathUtils';

/** Every extension the gallery accepts, in the order the module lists them */
const MEDIA_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS];

describe(hasValidMediaExtension, () => {
    // Derived from the extension lists, so an extension added to either one is
    // held to this contract rather than being accepted untested
    it.each(MEDIA_EXTENSIONS)('accepts .%s', (ext) => {
        expect(hasValidMediaExtension(`photo.${ext}`)).toBe(true);
    });

    it.each(MEDIA_EXTENSIONS)('accepts .%s spelled in upper case', (ext) => {
        expect(hasValidMediaExtension(`photo.${ext.toUpperCase()}`)).toBe(true);
    });

    it.each([
        // Formats the gallery does not take, including one it plausibly might
        'photo.txt',
        'photo.pdf',
        'photo.webp',
        // An extension is not a filename: something has to precede the dot
        '.jpg',
        '.png',
        '.heic',
        // A supported extension has to be the last one
        'photo.jpg.txt',
        // and has to be an extension at all
        'photo',
        'jpg',
        '',
    ])('rejects %s', (fileName) => {
        expect(hasValidMediaExtension(fileName)).toBe(false);
    });
});

describe(validMediaExtensionsString, () => {
    // Shown to admins when an upload is rejected, so it is pinned as the exact
    // user-facing string. Adding an extension is meant to fail this test: the
    // message changes, and someone should see how it reads.
    it('lists every supported extension, dotted and comma-separated', () => {
        expect(validMediaExtensionsString()).toBe(
            '.jpg, .jpeg, .png, .gif, .heic, .heif, .mp4, .mov, .avi, .mkv, .webm, .m4v, .3gp, .mpg, .mpeg',
        );
    });
});

describe(sanitizeAlbumName, () => {
    it.each([
        // Already valid names survive untouched
        { in: '12-31', out: '12-31' },
        { in: '01-01', out: '01-01' },

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

describe(isValidMediaNameWithoutExtensionStrict, () => {
    it.each([
        // Lower-case alphanumerics, with single underscores between them
        { name: 'photo', valid: true },
        { name: 'photo1', valid: true },
        { name: '1photo', valid: true },
        { name: '123', valid: true },
        { name: 'a', valid: true },
        { name: '1', valid: true },
        { name: 'my_photo', valid: true },
        { name: 'my_photo_1', valid: true },
        { name: 'a_b_c_d', valid: true },
        { name: 'photo_1_2_3', valid: true },
        { name: '1_2', valid: true },

        // An underscore has to separate two things, so it cannot double up or
        // sit at either end
        { name: 'a__b', valid: false },
        { name: 'photo__1', valid: false },
        { name: 'a___b', valid: false },
        { name: '_photo', valid: false },
        { name: '__photo', valid: false },
        { name: 'photo_', valid: false },
        { name: 'photo__', valid: false },
        { name: '_', valid: false },
        { name: '__', valid: false },
        { name: '_photo_', valid: false },

        // Everything sanitizeMediaBaseName would have removed
        { name: 'Photo', valid: false },
        { name: 'PHOTO', valid: false },
        { name: 'myPhoto', valid: false },
        { name: 'my-photo', valid: false },
        { name: 'photo-1', valid: false },
        { name: 'my photo', valid: false },
        { name: 'photo@1', valid: false },

        // The name is the part before the extension, so it carries no dot
        { name: 'photo.jpg', valid: false },

        { name: '', valid: false },
    ])('[$name]: $valid', ({ name, valid }) => {
        expect(isValidMediaNameWithoutExtensionStrict(name)).toBe(valid);
    });

    /**
     * A timing assertion, not a correctness one. The pattern this replaced --
     * /^[a-z0-9]+([a-z0-9_]*[a-z0-9]+)*$/ -- nests quantifiers over overlapping
     * character classes, so a name that fails only at its last character makes
     * it backtrack catastrophically. This exact input hangs it for over two
     * minutes; the current pattern separates the classes and returns at once.
     *
     * The timeout is generous next to a hang of that size, so it distinguishes
     * the two without being able to fail on a loaded machine.
     */
    it('rejects a long underscored name promptly rather than backtracking over it', () => {
        expect(isValidMediaNameWithoutExtensionStrict('monkey_river_15_howler_monkey_calling')).toBe(true);
        expect(isValidMediaNameWithoutExtensionStrict('monkey_river_15_howler_monkey_calling_')).toBe(false);
    }, 1000);
});

/**
 * A drag-and-drop can hand the same filename over twice, and two files cannot
 * share a path. The renamed one takes the lowest free suffix, which means
 * looking at the whole batch: a name a suffix would collide with may not have
 * been reached yet.
 */
describe(deduplicateMediaPaths, () => {
    it.each([
        { description: 'nothing to do', in: [], out: [] },
        {
            description: 'no duplicates',
            in: ['/2024/01-01/a.jpg', '/2024/01-01/b.jpg'],
            out: ['/2024/01-01/a.jpg', '/2024/01-01/b.jpg'],
        },

        // The first occurrence keeps the name; the rest are numbered from _2
        {
            description: 'one duplicate',
            in: ['/2024/01-01/photo.jpg', '/2024/01-01/photo.jpg'],
            out: ['/2024/01-01/photo.jpg', '/2024/01-01/photo_2.jpg'],
        },
        {
            description: 'two duplicates',
            in: ['/2024/01-01/photo.jpg', '/2024/01-01/photo.jpg', '/2024/01-01/photo.jpg'],
            out: ['/2024/01-01/photo.jpg', '/2024/01-01/photo_2.jpg', '/2024/01-01/photo_3.jpg'],
        },
        {
            description: 'two names duplicated independently',
            in: ['/2024/01-01/a.jpg', '/2024/01-01/b.jpg', '/2024/01-01/a.jpg', '/2024/01-01/b.jpg'],
            out: ['/2024/01-01/a.jpg', '/2024/01-01/b.jpg', '/2024/01-01/a_2.jpg', '/2024/01-01/b_2.jpg'],
        },

        // The suffix goes before the extension, whatever the extension is
        {
            description: 'duplicate png',
            in: ['/2024/01-01/photo.png', '/2024/01-01/photo.png'],
            out: ['/2024/01-01/photo.png', '/2024/01-01/photo_2.png'],
        },
        {
            description: 'duplicate video',
            in: ['/2024/01-01/clip.mp4', '/2024/01-01/clip.mp4'],
            out: ['/2024/01-01/clip.mp4', '/2024/01-01/clip_2.mp4'],
        },
        // Paths collide, not names: the same stem under two extensions is two
        // different files
        {
            description: 'same name, different extensions',
            in: ['/2024/01-01/photo.jpg', '/2024/01-01/photo.png'],
            out: ['/2024/01-01/photo.jpg', '/2024/01-01/photo.png'],
        },
        // and the same name in two albums likewise
        {
            description: 'same name in two day albums',
            in: ['/2024/01-01/photo.jpg', '/2024/01-02/photo.jpg'],
            out: ['/2024/01-01/photo.jpg', '/2024/01-02/photo.jpg'],
        },

        // A suffix skips any name the batch already contains, whether that name
        // arrives before or after the duplicate that would have taken it
        {
            description: 'the name a suffix wants is later in the batch',
            in: ['/2024/01-01/photo.jpg', '/2024/01-01/photo.jpg', '/2024/01-01/photo_2.jpg'],
            out: ['/2024/01-01/photo.jpg', '/2024/01-01/photo_3.jpg', '/2024/01-01/photo_2.jpg'],
        },
        {
            description: 'the name a suffix wants is earlier in the batch',
            in: ['/2024/01-01/photo_2.jpg', '/2024/01-01/photo.jpg', '/2024/01-01/photo.jpg'],
            out: ['/2024/01-01/photo_2.jpg', '/2024/01-01/photo.jpg', '/2024/01-01/photo_3.jpg'],
        },
        {
            description: 'two suffixes in a row are already taken',
            in: [
                '/2024/01-01/photo.jpg',
                '/2024/01-01/photo.jpg',
                '/2024/01-01/photo_2.jpg',
                '/2024/01-01/photo_3.jpg',
            ],
            out: [
                '/2024/01-01/photo.jpg',
                '/2024/01-01/photo_4.jpg',
                '/2024/01-01/photo_2.jpg',
                '/2024/01-01/photo_3.jpg',
            ],
        },
    ])('$description', ({ in: mediaPaths, out }) => {
        expect(deduplicateMediaPaths(mediaPaths)).toStrictEqual(out);
    });

    it('returns a result of the same length as its input', () => {
        const mediaPaths = ['/2024/01-01/photo.jpg', '/2024/01-01/photo.jpg', '/2024/01-01/photo.jpg'];

        expect(deduplicateMediaPaths(mediaPaths)).toHaveLength(mediaPaths.length);
    });

    it('produces no duplicate paths, whatever it was given', () => {
        const mediaPaths = [
            '/2024/01-01/photo.jpg',
            '/2024/01-01/photo.jpg',
            '/2024/01-01/photo_2.jpg',
            '/2024/01-01/photo_2.jpg',
            '/2024/01-01/photo.jpg',
        ];

        const result = deduplicateMediaPaths(mediaPaths);

        expect(new Set(result).size).toBe(mediaPaths.length);
    });
});
