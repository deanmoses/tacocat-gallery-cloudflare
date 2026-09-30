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
import { readImage } from '../../src/media/exif';
import { fixtureBytes } from '../gallery';

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
