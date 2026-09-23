import jpgDataUrl from '../../fixtures/FullMetadata.jpg?inline';
import { describe, expect, it, vi } from 'vitest';
import { type R2EventMessage, readCaption, versionIdFor } from '../../src/upload';

const jpg = Uint8Array.fromBase64(jpgDataUrl.slice(jpgDataUrl.indexOf(',') + 1));

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

describe(readCaption, () => {
    it('reads the IPTC title and description', () => {
        expect(readCaption(jpg.buffer, 'a.jpg')).toStrictEqual({
            title: 'My Image Title',
            description: 'My image description',
        });
    });

    it('has no caption for a file ExifReader cannot parse, and logs why', () => {
        const logged = vi.spyOn(console, 'error').mockReturnValue();

        expect(readCaption(new Uint8Array(10).buffer, 'broken.jpg')).toStrictEqual({ title: null, description: null });
        expect(logged).toHaveBeenCalledWith(expect.objectContaining({ event: 'exif_failed', key: 'broken.jpg' }));
    });
});
