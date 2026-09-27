import heic from '../../fixtures/FullMetadataHeic.heic?inline';
import jpg from '../../fixtures/FullMetadata.jpg?inline';
import mp4 from '../../fixtures/test_video.mp4?inline';
import png from '../../fixtures/pngFormat.png?inline';
import { describe, expect, it } from 'vitest';
import { SNIFF_LENGTH, isHeicType, sniffMedia } from '../../src/media/sniff';

/** The first bytes of a fixture, as the pipeline reads them. */
function head(dataUrl: string): Uint8Array {
    return Uint8Array.fromBase64(dataUrl.slice(dataUrl.indexOf(',') + 1)).subarray(0, SNIFF_LENGTH);
}

/** An ISO base media file's first box: its length, `ftyp`, and the brand. */
function ftyp(brand: string): Uint8Array {
    return Uint8Array.from([0, 0, 0, 0x14, ...Array.from('ftyp', ascii), ...Array.from(brand, ascii), 0, 0, 0, 0]);
}

/** An EBML header naming its document type, as WebM and Matroska files start. */
function ebml(docType: string): Uint8Array {
    return Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0xa3, 0x42, 0x82, docType.length, ...Array.from(docType, ascii)]);
}

function ascii(char: string): number {
    return char.codePointAt(0) ?? 0;
}

describe(sniffMedia, () => {
    // The formats with a fixture are read from it; the rest from the header each format is defined by.
    it.each([
        {
            name: 'a JPEG',
            bytes: head(jpg),
            sniffed: { mediaType: 'image', contentType: 'image/jpeg', extension: 'jpg' },
        },
        {
            name: 'a PNG',
            bytes: head(png),
            sniffed: { mediaType: 'image', contentType: 'image/png', extension: 'png' },
        },
        {
            name: 'a GIF',
            bytes: Uint8Array.from(Array.from('GIF89a', ascii)),
            sniffed: { mediaType: 'image', contentType: 'image/gif', extension: 'gif' },
        },
        {
            name: 'an iPhone HEIC',
            bytes: head(heic),
            sniffed: { mediaType: 'image', contentType: 'image/heic', extension: 'heic' },
        },
        {
            name: 'a HEIF',
            bytes: ftyp('mif1'),
            sniffed: { mediaType: 'image', contentType: 'image/heif', extension: 'heif' },
        },
        {
            name: 'an MP4',
            bytes: head(mp4),
            sniffed: { mediaType: 'video', contentType: 'video/mp4', extension: 'mp4' },
        },
        {
            name: 'a QuickTime movie',
            bytes: ftyp('qt  '),
            sniffed: { mediaType: 'video', contentType: 'video/quicktime', extension: 'mov' },
        },
        {
            name: 'an M4V',
            bytes: ftyp('M4V '),
            sniffed: { mediaType: 'video', contentType: 'video/x-m4v', extension: 'm4v' },
        },
        {
            name: 'a 3GP',
            bytes: ftyp('3gp5'),
            sniffed: { mediaType: 'video', contentType: 'video/3gpp', extension: '3gp' },
        },
        {
            name: 'an AVI',
            bytes: Uint8Array.from([
                ...Array.from('RIFF', ascii),
                0xe6,
                0xe8,
                0x14,
                0x00,
                ...Array.from('AVI ', ascii),
            ]),
            sniffed: { mediaType: 'video', contentType: 'video/x-msvideo', extension: 'avi' },
        },
        {
            name: 'a WebM',
            bytes: ebml('webm'),
            sniffed: { mediaType: 'video', contentType: 'video/webm', extension: 'webm' },
        },
        {
            name: 'a Matroska file',
            bytes: ebml('matroska'),
            sniffed: { mediaType: 'video', contentType: 'video/x-matroska', extension: 'mkv' },
        },
        {
            name: 'an MPEG program stream',
            bytes: Uint8Array.from([0x00, 0x00, 0x01, 0xba, 0x44]),
            sniffed: { mediaType: 'video', contentType: 'video/mpeg', extension: 'mpg' },
        },
    ])('knows $name', ({ bytes, sniffed }) => {
        expect(sniffMedia(bytes)).toStrictEqual(sniffed);
    });

    it.each([
        { name: 'nothing', bytes: new Uint8Array(0) },
        { name: 'zeros', bytes: new Uint8Array(16) },
        { name: 'text', bytes: Uint8Array.from(Array.from('hello there', ascii)) },
        // An ISO base media file of a brand the gallery does not take: an AVIF image, or an audio file.
        { name: 'an AVIF', bytes: ftyp('avif') },
        { name: 'an M4A', bytes: ftyp('M4A ') },
        { name: 'an EBML file that is neither WebM nor Matroska', bytes: ebml('other') },
        {
            name: 'a RIFF that is no AVI',
            bytes: Uint8Array.from([...Array.from('RIFF', ascii), 0, 0, 0, 0, ...Array.from('WAVE', ascii)]),
        },
    ])('refuses $name', ({ bytes }) => {
        expect(sniffMedia(bytes)).toBeNull();
    });
});

describe(isHeicType, () => {
    it('is true of the two HEIF content types and nothing else', () => {
        expect(['image/heic', 'image/heif', 'image/jpeg', 'video/quicktime', ''].map(isHeicType)).toStrictEqual([
            true,
            true,
            false,
            false,
            false,
        ]);
    });
});
