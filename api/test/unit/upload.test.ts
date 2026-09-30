import heicDataUrl from '../../fixtures/FullMetadataHeic.heic?inline';
import jpgDataUrl from '../../fixtures/FullMetadata.jpg?inline';
import noDescriptionDataUrl from '../../fixtures/NoDescription.jpg?inline';
import bareHeicDataUrl from '../../fixtures/NoDescriptionOrKeywordsOrCopyrightHeic.heic?inline';
import noHeadlineDataUrl from '../../fixtures/NoHeadline.jpg?inline';
import noTagsDataUrl from '../../fixtures/NoTags.jpg?inline';
import noTitleDataUrl from '../../fixtures/NoTitle.jpg?inline';
import noTitleOrHeadlineDataUrl from '../../fixtures/NoTitleOrHeadline.jpg?inline';
import turnedDataUrl from '../../fixtures/PortraitOrientation6.jpg?inline';
import pngDataUrl from '../../fixtures/pngFormat.png?inline';
import { isVersionId } from '@tacocat-gallery/shared';
import { describe, expect, it } from 'vitest';
import { transcodeJob } from '../../src/gallery/upload';
import { mintVersionId } from '../../src/storage/keys';
import { readImage } from '../../src/media/exif';
import { fixtureBytes } from '../gallery';

/** Crockford base32 as a number; exact only up to 53 bits, which is more than the comparison needs. */
function crockfordValue(text: string): number {
    let value = 0;
    for (const char of text) {
        value = value * 32 + '0123456789ABCDEFGHJKMNPQRSTVWXYZ'.indexOf(char);
    }
    return value;
}

describe(mintVersionId, () => {
    it('sorts a later id after an earlier one, whatever the random half', () => {
        const earlier = mintVersionId(Date.parse('2024-06-15T12:00:00.000Z'));
        const later = mintVersionId(Date.parse('2024-06-15T12:00:00.001Z'));

        expect([later, earlier].toSorted()).toStrictEqual([earlier, later]);
    });

    it('differs between two minted at the same moment', () => {
        const now = Date.parse('2024-06-15T12:00:00.000Z');

        expect(mintVersionId(now)).not.toBe(mintVersionId(now));
    });

    it('is a ULID, so any ULID tool decodes it and the constraint admits it', () => {
        const id = mintVersionId();

        expect(id).toMatch(/^[0-7][\dA-HJKMNP-TV-Z]{25}$/v);
        expect(isVersionId(id)).toBe(true);
    });

    it("encodes the timestamp as the spec's own example does", () => {
        // The spec's README: ulid(1469918176385) starts 01ARYZ6S41.
        expect(mintVersionId(1_469_918_176_385).slice(0, 10)).toBe('01ARYZ6S41');
    });

    it('keeps its random half apart from the last id, so one id of a batch gives away no other', () => {
        const now = Date.parse('2024-06-15T12:00:00.000Z');
        const [first, second] = [mintVersionId(now), mintVersionId(now)];
        const distance = Math.abs(crockfordValue(first.slice(10)) - crockfordValue(second.slice(10)));

        expect(first.slice(0, 10)).toBe(second.slice(0, 10));
        expect(distance).toBeGreaterThan(1000);
    });
});

describe(readImage, () => {
    const swift = {
        description: "Portriat from the cover of Taylor's Lover album",
        tags: ['Taylor', 'Swift', 'TSwift', 'rock', 'star', 'album', 'cover'],
    };

    // The AWS Lambda's own fixtures, and what its tests expect of each, so a file captioned once reads the same on
    // either site. The JPEGs carry IPTC and XMP, the HEICs and the PNG only XMP.
    it.each([
        {
            name: 'a JPEG with every IPTC field',
            file: jpgDataUrl,
            facts: {
                width: 300,
                height: 225,
                title: 'My Image Title',
                description: 'My image description',
                tags: ['halloween', 'dog', 'parade'],
            },
        },
        {
            name: 'a JPEG with no description',
            file: noDescriptionDataUrl,
            facts: { width: 220, height: 212, title: 'Taylor Swift', description: null, tags: swift.tags },
        },
        {
            name: 'a JPEG whose title is only in its headline, its XMP title blank',
            file: noTitleDataUrl,
            facts: { width: 220, height: 212, title: 'Taylor Swift', ...swift },
        },
        {
            name: 'a JPEG whose title is only in its IPTC object name',
            file: noHeadlineDataUrl,
            facts: { width: 220, height: 212, title: 'Taylor Swift', ...swift },
        },
        {
            name: 'a JPEG with neither title nor headline',
            file: noTitleOrHeadlineDataUrl,
            facts: { width: 220, height: 212, title: null, ...swift },
        },
        {
            name: 'a JPEG with no keywords',
            file: noTagsDataUrl,
            facts: { width: 220, height: 212, title: 'Taylor Swift', description: swift.description, tags: null },
        },
        {
            name: 'a HEIC, whose caption is only in XMP and whose size is only in EXIF',
            file: heicDataUrl,
            facts: {
                width: 4032,
                height: 3024,
                title: 'Test Image Title',
                description: 'Test description',
                tags: ['test1', 'test2', 'test3'],
            },
        },
        {
            name: 'a HEIC with only a title and a headline',
            file: bareHeicDataUrl,
            facts: { width: 4032, height: 3024, title: 'Test Image Title', description: null, tags: null },
        },
        {
            name: 'a PNG with no caption',
            file: pngDataUrl,
            facts: { width: 220, height: 212, title: null, description: null, tags: null },
        },
        // The pixels are stored landscape and shown turned a quarter, so the size is the shown one, as every crop is.
        {
            name: 'a JPEG shown turned by its EXIF orientation, captioned in Bridge',
            file: turnedDataUrl,
            facts: {
                width: 600,
                height: 800,
                title: 'The Gregangelo Museum',
                description: null,
                tags: ['Terry', 'Joyce', 'Gregangelo', 'museum'],
            },
        },
    ])('reads $name', async ({ file, facts }) => {
        await expect(readImage(fixtureBytes(file).buffer)).resolves.toStrictEqual({ ok: true, facts });
    });

    it('says why a file that is no image cannot be one', async () => {
        await expect(readImage(new Uint8Array(10).buffer)).resolves.toStrictEqual({
            ok: false,
            error: expect.stringContaining('not a readable image'),
        });
    });
});

describe(transcodeJob, () => {
    it('signs a read of the source in the uploads bucket and writes of both outputs in the derived bucket', async () => {
        const env = {
            R2_ACCESS_KEY_ID: 'test-access-key',
            R2_SECRET_ACCESS_KEY: 'test-secret-key',
            UPLOADS_BUCKET: 'test-uploads',
            DERIVED_BUCKET: 'test-derived',
        };

        const { versionId, sourceKey, ...urls } = await transcodeJob(env, 'inbox/2024/06-15/a', 'v1');
        const paths = Object.fromEntries(Object.entries(urls).map(([name, url]) => [name, new URL(url).pathname]));

        expect(versionId).toBe('v1');
        expect(sourceKey).toBe('inbox/2024/06-15/a');
        expect(paths).toStrictEqual({
            src: '/test-uploads/inbox/2024/06-15/a',
            mp4Put: '/test-derived/derived/v1/video.mp4',
            posterPut: '/test-derived/derived/v1/poster.jpg',
        });
    });
});
