import jpgDataUrl from '../../fixtures/FullMetadata.jpg?inline';
import { describe, expect, it, vi } from 'vitest';
import { scanStart, withoutMetadata } from '../../src/media/jpeg';
import { fixtureBytes, jpegParts } from '../gallery';

const jpg = fixtureBytes(jpgDataUrl);

describe(withoutMetadata, () => {
    it('drops the EXIF, XMP and IPTC blocks, and keeps the colour profile and the pixels byte for byte', () => {
        const before = jpegParts(jpg);
        const after = jpegParts(withoutMetadata(jpg));

        expect(before.segments.filter((segment) => segment === 'APP1')).toHaveLength(2);
        expect(before.segments).toContain('APP13');
        expect(after.segments).toStrictEqual(before.segments.filter((segment) => !['APP1', 'APP13'].includes(segment)));
        expect(after.segments).toContain('APP2');
        expect(after.scan).toStrictEqual(before.scan);
    });

    it.each([
        { name: 'bytes that are not a JPEG', bytes: Uint8Array.from(new TextEncoder().encode('GIF89a, not a JPEG')) },
        { name: 'a JPEG cut off inside its headers', bytes: jpg.slice(0, 100) },
        {
            name: 'a segment whose length is too short to be one',
            bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 0]),
        },
    ])('hands back $name unchanged, and says so', ({ bytes }) => {
        const warned = vi.spyOn(console, 'warn').mockReturnValue();

        expect(withoutMetadata(bytes)).toBe(bytes);
        expect(warned).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ event: 'jpeg_metadata_kept' }));
    });
});

describe(scanStart, () => {
    it('finds where the scan starts, from a head of the file that reaches it', () => {
        const scan = scanStart(jpg);

        expect(scan).not.toBeNull();
        expect(jpg.subarray(scan ?? 0, (scan ?? 0) + 2)).toStrictEqual(Uint8Array.from([0xff, 0xda]));
        expect(scanStart(jpg.subarray(0, (scan ?? 0) + 2))).toBe(scan);
    });

    it.each([
        { name: 'a head that ends inside the headers', bytes: jpg.subarray(0, 100) },
        { name: 'bytes that are not a JPEG', bytes: new TextEncoder().encode('GIF89a, not a JPEG') },
    ])('finds none in $name', ({ bytes }) => {
        expect(scanStart(bytes)).toBeNull();
    });
});
