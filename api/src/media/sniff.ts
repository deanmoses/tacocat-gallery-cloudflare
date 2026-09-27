import type { MediaType } from 'tacocat-gallery-shared';

/** What a file's first bytes say it is: which kind of media, its content type, and the extension a download of it gets. */
export interface SniffedMedia {
    mediaType: MediaType;
    contentType: string;
    extension: string;
}

/** How much of a file the sniffer reads: enough for an EBML header to name its document type. */
export const SNIFF_LENGTH = 64;

const HEIC_TYPES = new Set(['image/heic', 'image/heif']);

/** Whether a content type is a HEIC or HEIF, which only Safari can show. */
export function isHeicType(contentType: string): boolean {
    return HEIC_TYPES.has(contentType);
}

// The brands an ISO base media file declares in its `ftyp` box, which is the one place a HEIC and an MP4 differ in
// their first bytes. A brand not listed is refused rather than guessed at: an AVIF or an audio file has the same box.
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx']);
const HEIF_BRANDS = new Set(['mif1', 'msf1']);
const MP4_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'mp71', 'avc1', 'dash', 'mmp4']);
const M4V_BRANDS = new Set(['M4V ', 'M4VH', 'M4VP']);
const QUICKTIME_BRAND = 'qt  ';

/** What `bytes`, the start of a file, say the file is, or null for a file in no format the gallery takes. */
export function sniffMedia(bytes: Uint8Array): SniffedMedia | null {
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
        return image('image/jpeg', 'jpg');
    }
    if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        return image('image/png', 'png');
    }
    if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) {
        return image('image/gif', 'gif');
    }
    if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
        return ebml(bytes);
    }
    if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes.subarray(8), ascii('AVI '))) {
        return video('video/x-msvideo', 'avi');
    }
    if (startsWith(bytes, [0x00, 0x00, 0x01, 0xba]) || startsWith(bytes, [0x00, 0x00, 0x01, 0xb3])) {
        return video('video/mpeg', 'mpg');
    }
    return startsWith(bytes.subarray(4), ascii('ftyp')) ? isoBaseMedia(text(bytes.subarray(8, 12))) : null;
}

/** A HEIC, an MP4, a QuickTime movie or a 3GP, told apart by the brand after `ftyp`. */
function isoBaseMedia(brand: string): SniffedMedia | null {
    if (HEIC_BRANDS.has(brand)) {
        return image('image/heic', 'heic');
    }
    if (HEIF_BRANDS.has(brand)) {
        return image('image/heif', 'heif');
    }
    if (brand === QUICKTIME_BRAND) {
        return video('video/quicktime', 'mov');
    }
    if (M4V_BRANDS.has(brand)) {
        return video('video/x-m4v', 'm4v');
    }
    if (brand.startsWith('3gp') || brand.startsWith('3ge') || brand.startsWith('3gg') || brand.startsWith('3g2')) {
        return video('video/3gpp', '3gp');
    }
    return MP4_BRANDS.has(brand) ? video('video/mp4', 'mp4') : null;
}

/** WebM and Matroska share the EBML header; the document type a few bytes in says which. */
function ebml(bytes: Uint8Array): SniffedMedia | null {
    const header = text(bytes);
    if (header.includes('webm')) {
        return video('video/webm', 'webm');
    }
    return header.includes('matroska') ? video('video/x-matroska', 'mkv') : null;
}

function image(contentType: string, extension: string): SniffedMedia {
    return { mediaType: 'image', contentType, extension };
}

function video(contentType: string, extension: string): SniffedMedia {
    return { mediaType: 'video', contentType, extension };
}

function startsWith(bytes: Uint8Array, pattern: readonly number[]): boolean {
    return pattern.every((byte, index) => bytes[index] === byte);
}

function ascii(word: string): number[] {
    return Array.from(word, (char) => char.codePointAt(0) ?? 0);
}

function text(bytes: Uint8Array): string {
    return String.fromCodePoint(...bytes);
}
