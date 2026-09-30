import { describe, expect, it } from 'vitest';
import { copiedCrop } from '../../scripts/aws-crops.ts';

describe(copiedCrop, () => {
    it('keeps a crop that fits', () => {
        const crop = { x: 669, y: 68, width: 1933, height: 1932 };

        expect(copiedCrop(crop, { width: 3008, height: 2000 })).toStrictEqual(crop);
    });

    // /2023/05-07/horse_race5.jpg: AWS's square ran 5 pixels past a 3648-high photo
    it('trims a square a few pixels past the image about its centre, keeping it square', () => {
        expect(copiedCrop({ x: 1819, y: 0, width: 3653, height: 3653 }, { width: 5472, height: 3648 })).toStrictEqual({
            x: 1822,
            y: 0,
            width: 3648,
            height: 3648,
        });
    });

    it('moves a trimmed crop back inside when it started before the edge', () => {
        expect(copiedCrop({ x: -3, y: 10, width: 100, height: 100 }, { width: 400, height: 300 })).toStrictEqual({
            x: 0,
            y: 10,
            width: 100,
            height: 100,
        });
    });

    // /2025/12-28/uc_campus1.jpg: cut against the photo's size with width and height swapped
    it('drops a crop drawn against the rotated size', () => {
        expect(copiedCrop({ x: 0, y: 0, width: 2269, height: 4032 }, { width: 4032, height: 3024 })).toBeNull();
    });
});
