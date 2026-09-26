import { describe, expect, it } from 'vitest';
import { outputFormat, resize } from '../../src/media/images';

const PHOTO = { path: '/2001/06-15/felix.jpg', versionId: 'v1' };

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
    const CHROME = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';
    const OLD_SAFARI = 'image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5';
    const THUMBNAIL = { width: 200, height: 200 };
    const DETAIL = { width: 1024, height: null };

    it.each([
        {
            name: 'nothing, for a thumbnail, with no Accept header',
            requested: null,
            accept: null,
            size: THUMBNAIL,
            format: 'image/webp',
        },
        {
            name: 'nothing, for a thumbnail, by a browser that accepts WebP',
            requested: null,
            accept: CHROME,
            size: THUMBNAIL,
            format: 'image/webp',
        },
        {
            name: 'nothing, for a thumbnail, by a browser that accepts only image/*',
            requested: null,
            accept: OLD_SAFARI,
            size: THUMBNAIL,
            format: 'image/jpeg',
        },
        {
            name: 'nothing, for the detail image, by a browser that accepts WebP',
            requested: null,
            accept: CHROME,
            size: DETAIL,
            format: 'image/jpeg',
        },
        {
            name: 'nothing, for the detail image, with no Accept header',
            requested: null,
            accept: null,
            size: DETAIL,
            format: 'image/jpeg',
        },
        {
            name: 'JPEG, for a thumbnail, by a browser that accepts WebP',
            requested: 'image/jpeg',
            accept: CHROME,
            size: THUMBNAIL,
            format: 'image/jpeg',
        },
        {
            name: 'WebP, for the detail image',
            requested: 'image/webp',
            accept: CHROME,
            size: DETAIL,
            format: 'image/webp',
        },
        {
            name: 'WebP, by a browser that does not accept it',
            requested: 'image/webp',
            accept: OLD_SAFARI,
            size: THUMBNAIL,
            format: 'image/webp',
        },
        { name: 'raw pixels', requested: 'rgb', accept: OLD_SAFARI, size: THUMBNAIL, format: 'image/jpeg' },
        { name: 'a word', requested: 'bmp', accept: CHROME, size: THUMBNAIL, format: 'image/webp' },
    ])('answers $name asked for with $format', ({ requested, accept, size, format }) => {
        expect(outputFormat(requested, accept, size)).toBe(format);
    });
});
