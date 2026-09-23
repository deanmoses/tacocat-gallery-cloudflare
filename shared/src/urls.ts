import type { Rectangle } from './album';

// The URLs the web app asks the Worker for media by. Both ends build and read them here, and a derivative's stored key
// is made from the same text, so a derivative is found again only if every URL for it is spelled the same way.

/** At least one side, in pixels. With both, the image is cut to cover them; with one, scaled to it. */
export type ImageSize = { width: number; height: number | null } | { width: null; height: number };

/** What an image URL asks for: a version of a media item, sized, and first cut to `crop` if there is one. */
export interface ImageRequest {
    path: string;
    versionId: string;
    size: ImageSize;
    crop: Rectangle | null;
}

/** The query string of a URL, as far as reading it goes. */
export interface Query {
    get: (name: string) => string | null;
}

const DEFAULT_SIZE: ImageSize = { width: 1024, height: null };
const SIZE = /^(?<width>[1-9]\d*)?(?:x(?<height>[1-9]\d*))?$/v;
const COORDINATE = /^(?:0|[1-9]\d*)(?:\.\d+)?$/v;

/** `/i/2001/06-15/felix.jpg/v1?size=200x200&crop=10,20,300,300` */
export function imageUrl({ path, versionId, size, crop }: ImageRequest): string {
    const cropped = crop === null ? '' : `&crop=${cropText(crop)}`;
    return `/i${path}/${versionId}?size=${sizeText(size)}${cropped}`;
}

/**
 * Reads an image URL, given its path after the route prefix (`/2001/06-15/felix.jpg/v1`) and its query. Null for
 * anything `imageUrl` would not have written, apart from a missing size, which is the default.
 */
export function parseImageRequest(rest: string, query: Query): ImageRequest | null {
    const cut = rest.lastIndexOf('/');
    const path = rest.slice(0, cut);
    const versionId = rest.slice(cut + 1);
    const sizeParam = query.get('size');
    const size = sizeParam === null ? DEFAULT_SIZE : parseSize(sizeParam);
    const cropParam = query.get('crop');
    const crop = cropParam === null ? null : parseCrop(cropParam);
    return !path.startsWith('/') || versionId === '' || size === null || (cropParam !== null && crop === null)
        ? null
        : { path, versionId, size, crop };
}

/** `200x200`, `1024` for a width alone, `x1024` for a height alone. */
export function sizeText({ width, height }: ImageSize): string {
    return `${width ?? ''}${height === null ? '' : `x${height}`}`;
}

/** `10,20,300,300`: x, y, width, height. */
export function cropText({ x, y, width, height }: Rectangle): string {
    return `${x},${y},${width},${height}`;
}

/** A version of a media item as it was uploaded, whatever format that is. */
export function originalUrl(path: string, versionId: string): string {
    return `/raw/originals${path}/${versionId}`;
}

/** The R2 prefix under which a version's derivatives live: the transcoder's MP4 and poster, and every image size. */
export function derivedPrefix(path: string, versionId: string): string {
    return `derived${path}/${versionId}`;
}

/** The file name the transcoder writes a video's MP4 under, in its version's derived prefix. */
export const VIDEO_FILE = 'video.mp4';

/** A version of a video as the MP4 the transcoder wrote, served with byte ranges. */
export function videoUrl(path: string, versionId: string): string {
    return `/v/${derivedPrefix(path, versionId)}/${VIDEO_FILE}`;
}

function parseSize(text: string): ImageSize | null {
    const match = SIZE.exec(text);
    const width = match?.groups?.['width'];
    const height = match?.groups?.['height'];
    if (width !== undefined) {
        return { width: Number(width), height: height === undefined ? null : Number(height) };
    }
    return height === undefined ? null : { width: null, height: Number(height) };
}

function parseCrop(text: string): Rectangle | null {
    const parts = text.split(',');
    if (parts.length !== 4 || parts.some((part) => !COORDINATE.test(part))) {
        return null;
    }
    const [left = 0, top = 0, width = 0, height = 0] = parts.map(Number);
    return width > 0 && height > 0 ? { x: left, y: top, width, height } : null;
}
