import jpgDataUrl from '../../fixtures/FullMetadata.jpg?inline';
import { describe, expect, it, vi } from 'vitest';
import { withoutMetadata } from '../../src/media/jpeg';
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
