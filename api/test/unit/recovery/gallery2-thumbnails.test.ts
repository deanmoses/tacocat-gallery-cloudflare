import { describe, expect, it } from 'vitest';
import type { Gallery2Item } from '../../../scripts/recovery/gallery2.ts';
import {
    type Gallery2Derivative,
    type LostCrop,
    cropOutcome,
    lostCrops,
} from '../../../scripts/recovery/gallery2-thumbnails.ts';

function album(fields: Partial<Gallery2Item> & { id: number; parent: number; name: string | null }): Gallery2Item {
    return {
        type: 'GalleryAlbumItem',
        title: null,
        summary: null,
        desc: null,
        order: null,
        albumOrder: null,
        width: null,
        height: null,
        ...fields,
    };
}

function photo(fields: Partial<Gallery2Item> & { id: number; parent: number; name: string }): Gallery2Item {
    return {
        type: 'GalleryPhotoItem',
        title: null,
        summary: null,
        desc: null,
        order: null,
        albumOrder: null,
        width: 1024,
        height: 768,
        ...fields,
    };
}

function derivative(
    fields: Partial<Gallery2Derivative> & { id: number; parent: number; operations: string },
): Gallery2Derivative {
    return { source: fields.parent, type: 1, ...fields };
}

const TREE = [
    album({ id: 7, parent: 0, name: null }),
    album({ id: 19, parent: 7, name: '2012' }),
    album({ id: 20, parent: 19, name: '06-03' }),
    album({ id: 21, parent: 20, name: 'shakescene' }),
    photo({ id: 31, parent: 21, name: 'Shake-Scene13.jpg' }),
    photo({ id: 32, parent: 21, name: 'bow.jpg', width: 768, height: 1024 }),
    photo({ id: 33, parent: 21, name: 'curtain.jpg' }),
    photo({ id: 34, parent: 21, name: 'lost.jpg' }),
];
const MATCHES = [
    { g2: '2012/06-03/shakescene/Shake-Scene13.jpg', zen: '2012/06-04/shakescene13.jpg' },
    { g2: '2012/06-03/shakescene/bow.jpg', zen: '2012/06-04/shakescene-bow.jpg' },
    { g2: '2012/06-03/shakescene/curtain.jpg', zen: '2012/06-04/curtain.jpg' },
];

describe(lostCrops, () => {
    it("traces a crop to the photo's name today, in percent of the image it was cut from", () => {
        const derivatives = [
            derivative({ id: 41, parent: 31, operations: 'crop|31.449,25.6,27.56,41.45;thumbnail|200' }),
        ];

        expect(lostCrops(TREE, derivatives, MATCHES)).toStrictEqual({
            crops: [
                {
                    from: '2012/06-03/shakescene/Shake-Scene13.jpg',
                    path: '/2012/06-04/shakescene13',
                    crop: { x: 31.449, y: 25.6, width: 27.56, height: 41.45 },
                    shape: { width: 1024, height: 768 },
                },
            ],
            unmatched: [],
        });
    });

    it('leaves out a thumbnail made from the whole photo, and the thumbnails of albums', () => {
        const derivatives = [
            derivative({ id: 41, parent: 31, operations: 'thumbnail|200' }),
            derivative({ id: 42, parent: 21, source: 31, operations: 'crop|10,10,50,50;thumbnail|150' }),
        ];

        expect(lostCrops(TREE, derivatives, MATCHES).crops).toStrictEqual([]);
    });

    it('swaps the shape of a photo Gallery 2 turned a quarter, since the crop is of the turned version', () => {
        const derivatives = [
            derivative({ id: 43, parent: 32, type: 3, operations: 'rotate|-90' }),
            derivative({ id: 44, parent: 32, source: 43, operations: 'crop|0,10,100,75;thumbnail|200' }),
        ];

        expect(lostCrops(TREE, derivatives, MATCHES).crops[0]?.shape).toStrictEqual({ width: 1024, height: 768 });
    });

    it('keeps the shape of a photo Gallery 2 turned upside down', () => {
        const derivatives = [
            derivative({ id: 43, parent: 33, type: 3, operations: 'rotate|180' }),
            derivative({ id: 44, parent: 33, source: 43, operations: 'crop|10,0,75,100;thumbnail|200' }),
        ];

        expect(lostCrops(TREE, derivatives, MATCHES).crops[0]?.shape).toStrictEqual({ width: 1024, height: 768 });
    });

    it('moves a crop Gallery 2 rounded a thousandth past the edge back inside it', () => {
        const derivatives = [derivative({ id: 41, parent: 33, operations: 'crop|33.701,0,66.3,100;thumbnail|200' })];
        const [lost] = lostCrops(TREE, derivatives, MATCHES).crops;

        expect(lost?.crop.width).toBe(66.3);
        expect((lost?.crop.x ?? 0) + (lost?.crop.width ?? 0)).toBeLessThanOrEqual(100);
        expect(lost?.crop.x).toBeCloseTo(33.7, 6);
    });

    it('says which cropped photos the comparison matched to nothing', () => {
        const derivatives = [derivative({ id: 41, parent: 34, operations: 'crop|10,10,50,50;thumbnail|200' })];

        expect(lostCrops(TREE, derivatives, MATCHES)).toStrictEqual({
            crops: [],
            unmatched: ['2012/06-03/shakescene/lost.jpg'],
        });
    });
});

describe(cropOutcome, () => {
    const lost: LostCrop = {
        from: '2007/01-28/skateboard1.jpg',
        path: '/2007/01-28/skateboard1',
        crop: { x: 31.449, y: 25.6, width: 27.56, height: 41.45 },
        shape: { width: 1024, height: 683 },
    };

    it("writes onto an uncropped photo of Gallery 2's shape, though the gallery's file is larger", () => {
        expect(cropOutcome(lost, { width: 3008, height: 2000, crop: null })).toBe('write');
    });

    it('says a crop this script wrote already is done, to the pixel the rounding moves an edge by', () => {
        expect(
            cropOutcome(lost, { width: 3008, height: 2000, crop: { x: 946, y: 512, width: 829, height: 829 } }),
        ).toBe('done');
        expect(
            cropOutcome(lost, { width: 3008, height: 2000, crop: { x: 945, y: 513, width: 830, height: 828 } }),
        ).toBe('done');
    });

    it('leaves a photo the album no longer has', () => {
        expect(cropOutcome(lost, undefined)).toBe('missing');
    });

    it("leaves a crop an admin cut since, which stands over Gallery 2's", () => {
        expect(
            cropOutcome(lost, { width: 3008, height: 2000, crop: { x: 100, y: 0, width: 2000, height: 2000 } }),
        ).toBe('cropped');
    });

    it('leaves a photo whose file is another shape, which the crop would not line up with', () => {
        expect(cropOutcome(lost, { width: 3648, height: 2736, crop: null })).toBe('reshaped');
        expect(cropOutcome(lost, { width: null, height: null, crop: null })).toBe('reshaped');
    });
});
