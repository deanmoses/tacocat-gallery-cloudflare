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

/** A media name whose extension is one the gallery takes, image or video: what an upload may be called. */
export function hasMediaExtension(name: string): boolean {
    const extension = extensionOf(name);
    return (
        isMediaName(name) &&
        ((IMAGE_EXTENSIONS as readonly string[]).includes(extension) ||
            (VIDEO_EXTENSIONS as readonly string[]).includes(extension))
    );
}

/** `felix.jpg` without its extension: `felix`. */
export function baseNameOf(name: string): string {
    return name.slice(0, name.lastIndexOf('.'));
}

/**
 * A file name as a rename may give it: lowercase letters and digits, single underscores between them, and a lowercase
 * extension. Uploads keep the name the file came with; renaming is where the gallery tidies one.
 */
export function isStrictMediaName(name: string): boolean {
    return STRICT_MEDIA_NAME.test(name);
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
