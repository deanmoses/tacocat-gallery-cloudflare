import type { Rectangle, Size } from './album';
import { isMediaPath } from './paths';

// The URLs the web app asks the Worker for media by. Both ends build and read them here, and the Worker keys a stored
// derivative from the same text, so a derivative is found again only if every URL for it is spelled the same way.

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

/** One version of one media item: what the raw and video routes serve. */
export interface MediaVersion {
    path: string;
    versionId: string;
}

const DEFAULT_SIZE: ImageSize = { width: 1024, height: null };

/** The long side of the image the media page shows. */
const DETAIL_LONG_SIDE = 1024;

/** The size of a day album's thumbnails, which are square. */
export const THUMBNAIL_SIZE: ImageSize = { width: 200, height: 200 };

/**
 * The size the media page asks for: the long side at most 1024 and the image never enlarged, so a small image is asked
 * for at its own size. Both the app's request and the pipeline's pre-generation come from here, since a stored
 * derivative is found only by a URL spelled the same way.
 */
export function detailSize({ width, height }: Size): ImageSize {
    const longest = Math.max(width, height);
    const scale = longest <= DETAIL_LONG_SIDE ? 1 : DETAIL_LONG_SIDE / longest;
    return width > height
        ? { width: Math.round(width * scale), height: null }
        : { width: null, height: Math.round(height * scale) };
}
const VERSION_ID = /^[\w\-.]+$/v;
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

/**
 * Reads `/2001/06-15/felix.jpg/v1`, the path after a route's prefix, as a version of a media item. Null unless the
 * path is a media path and the version is letters, digits, dot, underscore and hyphen, which every version id is.
 */
export function parseMediaVersion(rest: string): MediaVersion | null {
    const cut = rest.lastIndexOf('/');
    const path = rest.slice(0, cut);
    const versionId = rest.slice(cut + 1);
    return isMediaPath(path) && VERSION_ID.test(versionId) ? { path, versionId } : null;
}

/** A version of a media item as it was uploaded, whatever format that is; a HEIC comes as a JPEG unless asked for. */
export function originalUrl(path: string, versionId: string): string {
    return `/raw${path}/${versionId}`;
}

/** A version of a video as the MP4 the transcoder wrote, served with byte ranges. */
export function videoUrl(path: string, versionId: string): string {
    return `/v${path}/${versionId}`;
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
