// Gallery paths, as the URL scheme has had them since 2001: the root album is `/`, a year album `/2001/`, a day album
// `/2001/06-15/` and a media item `/2001/06-15/felix.jpg`. Albums end in a slash and media do not.

/** The image formats an upload may have, as the AWS gallery accepted them. */
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'heic', 'heif'] as const;

/** The video formats an upload may have. Which of them the transcoder can read is ffmpeg's business. */
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', '3gp', 'mpg', 'mpeg'] as const;

const YEAR_NAME = /^\d{4}$/v;
const DAY_NAME = /^\d{2}-\d{2}$/v;
const MEDIA_NAME = /^[^.\/]+\.[^.\/]+$/v;
const HEIC_NAME = /\.(?:heic|heif)$/iv;
const STRICT_MEDIA_NAME = /^[0-9a-z]+(?:_[0-9a-z]+)*\.[0-9a-z]+$/v;

export function isYearName(name: string): boolean {
    return YEAR_NAME.test(name);
}

export function isDayName(name: string): boolean {
    return DAY_NAME.test(name);
}

/** A file name with one extension: `felix.jpg`. */
export function isMediaName(name: string): boolean {
    return MEDIA_NAME.test(name);
}

/** Videos are told apart from images by extension alone. */
export function isVideoName(name: string): boolean {
    return (VIDEO_EXTENSIONS as readonly string[]).includes(extensionOf(name));
}

/**
 * A media name as the gallery stores one: a listed extension, and `jpg` rather than `jpeg`. The lists say what file
 * an upload may be; a JPEG file is stored under `.jpg` whatever it was called, so `.jpeg` never names an item.
 */
export function isStoredMediaName(name: string): boolean {
    const extension = extensionOf(name);
    return (
        isMediaName(name) &&
        extension !== 'jpeg' &&
        ((IMAGE_EXTENSIONS as readonly string[]).includes(extension) ||
            (VIDEO_EXTENSIONS as readonly string[]).includes(extension))
    );
}

/** `felix.jpg` without its extension: `felix`. */
export function baseNameOf(name: string): string {
    return name.slice(0, name.lastIndexOf('.'));
}

/**
 * A media name as the sanitizer makes one and as an upload or a rename may give one: lowercase letters and digits,
 * single underscores between them, and a stored extension. The gallery copied from AWS holds older names that only
 * `isStoredMediaName` admits.
 */
export function isStrictMediaName(name: string): boolean {
    return STRICT_MEDIA_NAME.test(name) && hasStrictExtension(name);
}

/**
 * The extension as the sanitizer spells it: lowercase, one the gallery stores, `jpg` not `jpeg`. A replacement keeps
 * its target's base name, which may be an older one the sanitizer never saw, so its extension is all that is judged.
 */
export function hasStrictExtension(name: string): boolean {
    const extension = name.slice(name.lastIndexOf('.') + 1);
    return isStoredMediaName(name) && extension === extension.toLowerCase();
}

/**
 * A strict media name made from a file's name: lowercased, every run of anything else an underscore, none at either
 * end of the name, and `jpeg` spelled `jpg`. The extension is otherwise left as it is, so a file the gallery does not
 * take stays refusable by its name.
 */
export function sanitizeMediaFilename(fileName: string): string {
    const dot = fileName.lastIndexOf('.');
    if (dot === -1) {
        return sanitizeMediaBaseName(fileName);
    }
    const baseName = sanitizeMediaBaseName(fileName.slice(0, dot)).replace(/_$/v, '');
    const extension = fileName
        .slice(dot + 1)
        .toLowerCase()
        .replace(/^jpeg$/v, 'jpg');
    return `${baseName}.${extension}`;
}

/**
 * The name half of `sanitizeMediaFilename`, for a name being typed: a trailing underscore stays, since the next
 * character may be coming, and the strict rule refuses it if it is still there when the name is submitted.
 */
export function sanitizeMediaBaseName(baseName: string): string {
    return baseName
        .toLowerCase()
        .replaceAll(/[^0-9_a-z]+/gv, '_')
        .replaceAll(/_+/gv, '_')
        .replace(/^_/v, '');
}

/** The extension of a media name, lowercased and without the dot: `felix.JPG` is `jpg`. */
export function extensionOf(name: string): string {
    return name.slice(name.lastIndexOf('.') + 1).toLowerCase();
}

/** A HEIC, which only Safari can show, so the raw route offers it as a JPEG. */
export function isHeicName(name: string): boolean {
    return HEIC_NAME.test(name);
}

/** Whether `path` is the root, a year album or a day album. */
export function isAlbumPath(path: string): boolean {
    if (path === '/') {
        return true;
    }
    if (!path.startsWith('/') || !path.endsWith('/')) {
        return false;
    }
    const [year = '', day, deeper] = path.slice(1, -1).split('/', 3);
    return deeper === undefined && isYearName(year) && (day === undefined || isDayName(day));
}

export function isDayAlbumPath(path: string): boolean {
    return isAlbumPath(path) && (albumKey(path)?.parentPath ?? '/') !== '/';
}

/** Whether `path` is a media item in a day album: `/2001/06-15/felix.jpg`. */
export function isMediaPath(path: string): boolean {
    return mediaKey(path) !== null;
}

/** How the database identifies an item: the album it is in, and its name there. */
export interface ItemKey {
    parentPath: string;
    itemName: string;
}

/** An album's key: `/2001/06-15/` is `06-15` in `/2001/`. The root has none. */
export function albumKey(path: string): ItemKey | null {
    if (path === '/') {
        return null;
    }
    const cut = path.lastIndexOf('/', path.length - 2);
    return { parentPath: path.slice(0, cut + 1), itemName: path.slice(cut + 1, -1) };
}

/** A media item's key: `/2001/06-15/felix.jpg` is `felix.jpg` in `/2001/06-15/`. Anything but a media path has none. */
export function mediaKey(path: string): ItemKey | null {
    const cut = path.lastIndexOf('/');
    const key = { parentPath: path.slice(0, cut + 1), itemName: path.slice(cut + 1) };
    return isDayAlbumPath(key.parentPath) && isMediaName(key.itemName) ? key : null;
}

export function parentAlbumPath(path: string): string | null {
    return albumKey(path)?.parentPath ?? null;
}

export function albumPath(parentPath: string, itemName: string): string {
    return `${parentPath}${itemName}/`;
}

export function mediaPath(parentPath: string, itemName: string): string {
    return `${parentPath}${itemName}`;
}

/** The albums from the top down to `path` itself, the root left out: `/2001/06-15/` gives `/2001/` then itself. */
export function albumsEnclosing(path: string): ItemKey[] {
    const key = isAlbumPath(path) ? albumKey(path) : null;
    return key === null ? [] : [...albumsEnclosing(key.parentPath), key];
}
