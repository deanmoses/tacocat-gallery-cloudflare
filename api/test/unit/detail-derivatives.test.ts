import { describe, expect, it } from 'vitest';
import { isMetadataJpeg } from '../../scripts/detail-derivatives.ts';
import { testVersionId } from '../version-id.ts';

const under = `derived/${testVersionId('v1')}`;

describe(isMetadataJpeg, () => {
    it.each([
        { name: 'a landscape media page image', key: `${under}/1024` },
        { name: 'a portrait one', key: `${under}/x1024` },
        { name: 'one of a smaller original', key: `${under}/x612` },
        { name: 'a cropped one, which a URL may ask for', key: `${under}/1024-10,20.5,300,300` },
        { name: 'a thumbnail a URL asked for as JPEG', key: `${under}/200x200-jpeg` },
        { name: 'a cropped one', key: `${under}/200x200-1,2.5,30,30-jpeg` },
    ])('takes $name', ({ key }) => {
        expect(isMetadataJpeg(key)).toBe(true);
    });

    it.each([
        { name: "a video's MP4", key: `${under}/video.mp4` },
        { name: "a video's poster", key: `${under}/poster.jpg` },
        { name: 'a WebP thumbnail', key: `${under}/200x200-webp` },
        { name: 'a cropped WebP thumbnail', key: `${under}/200x200-1,2,30,30-webp` },
        { name: 'a size under something other than a version', key: 'derived/not-a-version/1024' },
        { name: 'a size outside the derived prefix', key: `originals/${testVersionId('v1')}/1024` },
        { name: 'a size a folder deeper', key: `${under}/old/1024` },
        { name: 'a size with a leading zero', key: `${under}/01024` },
        { name: 'the version itself', key: under },
    ])('leaves $name', ({ key }) => {
        expect(isMetadataJpeg(key)).toBe(false);
    });
});
