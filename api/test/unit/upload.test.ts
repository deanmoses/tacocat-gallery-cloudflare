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
import { describe, expect, it } from 'vitest';
import { type R2EventMessage, transcodeJob, versionIdFor } from '../../src/gallery/upload';
import { readImage } from '../../src/media/exif';

function bytes(dataUrl: string): ArrayBuffer {
    return Uint8Array.fromBase64(dataUrl.slice(dataUrl.indexOf(',') + 1)).buffer;
}

function uploadEvent(eventTime: string, eTag = 'etag-1'): R2EventMessage {
    return { action: 'PutObject', bucket: 'media', object: { key: 'inbox/2024/06-15/a.jpg', eTag }, eventTime };
}

describe(versionIdFor, () => {
    it('is the same for a redelivered event', async () => {
        const event = uploadEvent('2024-06-15T12:00:00.000Z');

        await expect(versionIdFor(event)).resolves.toBe(await versionIdFor(structuredClone(event)));
    });

    it('sorts a later upload of the same path after an earlier one', async () => {
        const earlier = await versionIdFor(uploadEvent('2024-06-15T12:00:00.000Z'));
        const later = await versionIdFor(uploadEvent('2024-06-15T12:00:00.001Z'));

        expect([later, earlier].toSorted()).toStrictEqual([earlier, later]);
    });

    it('differs for different contents uploaded at the same moment', async () => {
        const first = await versionIdFor(uploadEvent('2024-06-15T12:00:00.000Z', 'etag-1'));
        const second = await versionIdFor(uploadEvent('2024-06-15T12:00:00.000Z', 'etag-2'));

        expect(second).not.toBe(first);
    });

    it('can go in a URL path unescaped', async () => {
        const id = await versionIdFor(uploadEvent('2024-06-15T12:00:00.000Z'));

        expect(id).toMatch(/^[\da-z]+$/v);
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
        await expect(readImage(bytes(file))).resolves.toStrictEqual({ ok: true, facts });
    });

    it('says why a file that is no image cannot be one', async () => {
        await expect(readImage(new Uint8Array(10).buffer)).resolves.toStrictEqual({
            ok: false,
            error: expect.stringContaining('not a readable image'),
        });
    });
});

describe(transcodeJob, () => {
    it('signs a read of the source in the media bucket and writes of both outputs in the derived bucket', async () => {
        const env = {
            R2_ACCESS_KEY_ID: 'test-access-key',
            R2_SECRET_ACCESS_KEY: 'test-secret-key',
            MEDIA_BUCKET: 'test-media',
            DERIVED_BUCKET: 'test-derived',
        };

        const { sourceKey, ...urls } = await transcodeJob(env, 'inbox/2024/06-15/a.mov', 'v1');
        const paths = Object.fromEntries(Object.entries(urls).map(([name, url]) => [name, new URL(url).pathname]));

        expect(sourceKey).toBe('inbox/2024/06-15/a.mov');
        expect(paths).toStrictEqual({
            src: '/test-media/inbox/2024/06-15/a.mov',
            mp4Put: '/test-derived/derived/v1/video.mp4',
            posterPut: '/test-derived/derived/v1/poster.jpg',
        });
    });
});
