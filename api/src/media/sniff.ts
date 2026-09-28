import type { MediaType } from '@tacocat-gallery/shared';

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

/** The content type of every format the sniffer knows, and the extension a download of it is named with. */
const EXTENSIONS: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/x-m4v': 'm4v',
    'video/3gpp': '3gp',
    'video/x-msvideo': 'avi',
    'video/webm': 'webm',
    'video/x-matroska': 'mkv',
    'video/mpeg': 'mpg',
};

/** The extension a download of a stored original gets, from its content type; `bin` for a type the sniffer never wrote. */
export function extensionForType(contentType: string): string {
    return EXTENSIONS[contentType] ?? 'bin';
}

// The brands an ISO base media file declares in its `ftyp` box, which is the one place a HEIC and an MP4 differ in
// their first bytes: the major brand first, then the compatible ones, which is where a camera's own major brand,
// Sony's XAVC for one, says it is also an MP4. A file whose brands are all unknown is refused rather than guessed at,
// and one whose major brand is an AVIF or an audio file is refused however compatible it says it is.
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx']);
const HEIF_BRANDS = new Set(['mif1', 'msf1']);
const MP4_BRANDS = new Set([
    'isom',
    'iso2',
    'iso3',
    'iso4',
    'iso5',
    'iso6',
    'mp41',
    'mp42',
    'mp71',
    'avc1',
    'dash',
    'mmp4',
]);
const M4V_BRANDS = new Set(['M4V ', 'M4VH', 'M4VP']);
const QUICKTIME_BRAND = 'qt  ';
const REFUSED_BRANDS = new Set(['avif', 'avis', 'M4A ', 'M4B ', 'M4P ', 'F4A ', 'F4B ']);
// The atoms a QuickTime movie from before `ftyp` starts with, as older cameras and phones wrote them.
const QUICKTIME_ATOMS = new Set(['moov', 'mdat', 'wide', 'free', 'skip', 'pnot']);

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
    if (startsWith(bytes.subarray(4), ascii('ftyp'))) {
        return isoBaseMedia(bytes);
    }
    return QUICKTIME_ATOMS.has(text(bytes.subarray(4, 8))) ? video('video/quicktime', 'mov') : null;
}

/** A HEIC, an MP4, a QuickTime movie or a 3GP, told apart by the first brand of its `ftyp` box that says which. */
function isoBaseMedia(bytes: Uint8Array): SniffedMedia | null {
    const major = text(bytes.subarray(8, 12));
    if (REFUSED_BRANDS.has(major)) {
        return null;
    }
    const boxEnd = Math.min(new DataView(bytes.buffer, bytes.byteOffset).getUint32(0), bytes.length);
    const brands = [major];
    for (let at = 16; at + 4 <= boxEnd; at += 4) {
        brands.push(text(bytes.subarray(at, at + 4)));
    }
    for (const brand of brands) {
        const known = byBrand(brand);
        if (known !== null) {
            return known;
        }
    }
    return null;
}

function byBrand(brand: string): SniffedMedia | null {
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
