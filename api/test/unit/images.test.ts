import { describe, expect, it } from 'vitest';
import { formatForSource, outputFormat, outputOptions, resize } from '../../src/media/images';

const PHOTO = { path: '/2001/06-15/felix', versionId: 'v1' };

describe(resize, () => {
    it('covers an uncropped thumbnail from a third of the way down, where a face is likelier than the middle', () => {
        expect(resize({ ...PHOTO, size: { width: 200, height: 200 }, crop: null })).toStrictEqual({
            width: 200,
            height: 200,
            fit: 'cover',
            gravity: { x: 0.5, y: 1 / 3, mode: 'box-center' },
        });
    });

    it('covers a cropped thumbnail from the centre of the crop, which chose the frame already', () => {
        expect(
            resize({ ...PHOTO, size: { width: 200, height: 200 }, crop: { x: 10, y: 20, width: 300, height: 300 } }),
        ).toStrictEqual({ width: 200, height: 200, fit: 'cover' });
    });

    it.each([
        { name: 'a width', size: { width: 1024, height: null }, expected: { width: 1024, fit: 'scale-down' } },
        { name: 'a height', size: { width: null, height: 1024 }, expected: { height: 1024, fit: 'scale-down' } },
    ] as const)('scales down to $name alone, never enlarging', ({ size, expected }) => {
        expect(resize({ ...PHOTO, size, crop: null })).toStrictEqual(expected);
    });
});

describe(outputFormat, () => {
    const THUMBNAIL = { width: 200, height: 200 };
    const DETAIL = { width: 1024, height: null };

    it.each([
        { name: 'nothing, for a thumbnail', requested: null, size: THUMBNAIL, format: 'image/webp' },
        { name: 'nothing, for the detail image', requested: null, size: DETAIL, format: null },
        { name: 'JPEG, for a thumbnail', requested: 'image/jpeg', size: THUMBNAIL, format: 'image/jpeg' },
        { name: 'WebP, for the detail image', requested: 'image/webp', size: DETAIL, format: 'image/webp' },
        { name: 'raw pixels', requested: 'rgb', size: THUMBNAIL, format: 'image/webp' },
        { name: 'a word', requested: 'bmp', size: THUMBNAIL, format: 'image/webp' },
        { name: 'a word, for the detail image', requested: 'bmp', size: DETAIL, format: null },
    ])('answers $name asked for with $format', ({ requested, size, format }) => {
        expect(outputFormat(requested, size)).toBe(format);
    });
});

describe(formatForSource, () => {
    it.each([
        { source: 'image/gif', format: 'image/webp' },
        { source: 'image/png', format: 'image/webp' },
        { source: 'image/jpeg', format: 'image/jpeg' },
        { source: 'image/heic', format: 'image/jpeg' },
        { source: undefined, format: 'image/jpeg' },
    ])('makes $format from $source', ({ source, format }) => {
        expect(formatForSource(source)).toBe(format);
    });
});

describe(outputOptions, () => {
    it.each([
        {
            name: 'a 200x200 thumbnail: one frame, at the quality the album page has always had',
            format: 'image/webp',
            size: { width: 200, height: 200 },
            expected: { format: 'image/webp', quality: 85, anim: false },
        },
        {
            name: 'the 2x thumbnail: one frame, softer, since a 2x screen halves every artifact',
            format: 'image/webp',
            size: { width: 400, height: 400 },
            expected: { format: 'image/webp', quality: 75, anim: false },
        },
        {
            name: 'the 2x thumbnail as JPEG, for a browser without WebP: the usual quality',
            format: 'image/jpeg',
            size: { width: 400, height: 400 },
            expected: { format: 'image/jpeg', quality: 85, anim: false },
        },
        {
            name: 'the detail image: the usual quality, and no frame limit of its own',
            format: 'image/jpeg',
            size: { width: 1024, height: null },
            expected: { format: 'image/jpeg', quality: 85 },
        },
        {
            name: 'a detail image asked for as WebP: the usual quality and its frames kept, since only the 2x thumbnail is softer',
            format: 'image/webp',
            size: { width: 1024, height: null },
            expected: { format: 'image/webp', quality: 85 },
        },
    ] as const)('encodes $name', ({ format, size, expected }) => {
        expect(outputOptions(format, size)).toStrictEqual(expected);
    });
});
