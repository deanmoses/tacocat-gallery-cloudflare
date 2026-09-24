import heicDataUrl from '../../fixtures/FullMetadataHeic.heic?inline';
import jpgDataUrl from '../../fixtures/FullMetadata.jpg?inline';
import turnedDataUrl from '../../fixtures/PortraitOrientation6.jpg?inline';
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
    it('reads the size and the IPTC title and description', () => {
        expect(readImage(bytes(jpgDataUrl))).toStrictEqual({
            ok: true,
            facts: { width: 300, height: 225, title: 'My Image Title', description: 'My image description' },
        });
    });

    // The pixels are stored landscape and shown turned a quarter, so the size is the shown one, as every crop is.
    it('reads the size as the image is shown, turned by its EXIF orientation', () => {
        expect(readImage(bytes(turnedDataUrl))).toMatchObject({ ok: true, facts: { width: 600, height: 800 } });
    });

    it('reads the size of a HEIC from its EXIF, which is all ExifReader has for one', () => {
        expect(readImage(bytes(heicDataUrl))).toMatchObject({ ok: true, facts: { width: 4032, height: 3024 } });
    });

    it('says why a file that is no image cannot be one', () => {
        expect(readImage(new Uint8Array(10).buffer)).toStrictEqual({
            ok: false,
            error: expect.stringContaining('not a readable image'),
        });
    });
});

describe(transcodeJob, () => {
    it('signs URLs for the source and both outputs, into the media bucket', async () => {
        const env = {
            R2_ACCESS_KEY_ID: 'test-access-key',
            R2_SECRET_ACCESS_KEY: 'test-secret-key',
            MEDIA_BUCKET: 'test-media',
        };

        const { sourceKey, ...urls } = await transcodeJob(env, 'inbox/2024/06-15/a.mov', 'derived/2024/06-15/a.mov/v1');
        const paths = Object.fromEntries(Object.entries(urls).map(([name, url]) => [name, new URL(url).pathname]));

        expect(sourceKey).toBe('inbox/2024/06-15/a.mov');
        expect(paths).toStrictEqual({
            src: '/test-media/inbox/2024/06-15/a.mov',
            mp4Put: '/test-media/derived/2024/06-15/a.mov/v1/video.mp4',
            posterPut: '/test-media/derived/2024/06-15/a.mov/v1/poster.jpg',
        });
    });
});
