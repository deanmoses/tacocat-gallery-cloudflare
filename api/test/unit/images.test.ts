import { describe, expect, it } from 'vitest';
import { resize } from '../../src/media/images';

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
