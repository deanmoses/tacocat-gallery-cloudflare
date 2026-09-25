import {
    IMAGE_EXTENSIONS as SHARED_IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS as SHARED_VIDEO_EXTENSIONS,
} from 'tacocat-gallery-shared';

/** Supported image extensions, the ones the server accepts an upload of */
export const IMAGE_EXTENSIONS: string[] = [...SHARED_IMAGE_EXTENSIONS];

/** Supported video extensions, the ones the server accepts an upload of */
export const VIDEO_EXTENSIONS: string[] = [...SHARED_VIDEO_EXTENSIONS];

/** Pattern matching any valid media extension */
const MEDIA_EXT_PATTERN = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS].toSorted().join('|');

/** Regex for validating media file extensions */
const VALID_MEDIA_EXT_REGEX = new RegExp(String.raw`^.+\.(?:${MEDIA_EXT_PATTERN})$`, 'iv');

/** Regex for validating full media paths like /2001/12-31/image.jpg */
const VALID_MEDIA_PATH_REGEX = new RegExp(
    String.raw`^/\d{4}/(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])/[\w\-]+\.(?:${MEDIA_EXT_PATTERN})$`,
    'iv',
);

/**
 * Return true if filename ends with a supported media (image or video) extension
 */
export function hasValidMediaExtension(fileName: string): boolean {
    return VALID_MEDIA_EXT_REGEX.test(fileName);
}

/**
 * Return string of all valid media extensions, something like ".jpg, .jpeg, .png, .gif, .mov, .avi"
 */
export function validMediaExtensionsString(): string {
    return [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS].map((ext) => `.${ext}`).join(', ');
}

/**
 * Return true if specified string is a valid album, image, or video path
 * like / or /2001/ or /2001/12-31/ or /2001/12-31/image.jpg or /2001/12-31/video.mp4
 */
export function isValidPath(path: string): boolean {
    return isValidAlbumPath(path) || isValidMediaPath(path);
}

/**
 * Return true if specified string is a valid media path (image or video)
 * like /2001/12-31/image.jpg or /2001/12-31/video.mp4.
 *
 * Cannot be on root album like /image.jpg
 * Cannot be on year album like /2001/image.jpg
 * Must be on a day album like /2001/12-31/image.jpg
 */
export function isValidMediaPath(path: string): boolean {
    return VALID_MEDIA_PATH_REGEX.test(path);
}

/**
 * Return true if specified string is a valid album path
 * like / or /2001/ or /2001/12-31/
 */
export function isValidAlbumPath(path: string): boolean {
    return /^(?:\/\d{4}(?:\/(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))?)?\/$/v.test(path);
}

/**
 * Return true if specified string is a valid year album path like /2001/
 */
export function isValidYearAlbumPath(path: string): boolean {
    return /^\/\d{4}\/$/v.test(path);
}

/**
 * Return true if specified string is a valid day album path like /2001/12-31/
 */
export function isValidDayAlbumPath(path: string): boolean {
    return /^\/\d{4}\/(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\/$/v.test(path);
}

/**
 * Return true if specified string is a strictly valid media filename.
 * Must be lower case
 * No hyphens (-) just underscores (_)
 * Must not have a path.
 */
export function isValidMediaNameWithoutExtensionStrict(filename: string): boolean {
    // Pattern: alphanumeric start, then optional groups of (single underscore + alphanumeric)
    // ReDoS-safe because _ and [a-z0-9] are disjoint character classes (no ambiguity)
    // Old vulnerable pattern: /^[a-z0-9]+([a-z0-9_]*[a-z0-9]+)*$/
    return /^[0-9a-z]+(?:_[0-9a-z]+)*$/v.test(filename);
}

export function sanitizeDayAlbumName(albumName: string): string {
    return (albumName || '')
        .replaceAll(/[A-Za-z]+/gv, '') // letters to nothing
        .replaceAll(/[^\-0-9]+/gv, '-') // any other invalid chars to -
        .replaceAll(/-+/gv, '-') // multple - to single -
        .replaceAll(/^-/gv, ''); // remove leading -
}

/**
 * Return the specified path's parent path and leaf item
 *  - /2001/12-31/image.jpg returns '/2001/12-31/' and 'image.jpg'
 *  - /2001/12-31/ returns '/2001/' and '12-31'
 *  - /2001/ returns '/' and '2001'
 *  - / returns '' and ''
 *
 *  Album paths must end in a slash: /2001/12-31 (without one) is not a valid
 *  path and throws.
 *
 *  @param {String} path a path of the format /2001/12-31/image.jpg, or a subset thereof
 */
export function getParentAndNameFromPath(path: string): { parent: string; name: string } {
    if (!path) throw new Error('Invalid path: cannot be empty');
    const trimmedPath = path.trim();
    if (!trimmedPath) throw new Error('Invalid path: cannot be empty');
    if (!isValidPath(trimmedPath)) throw new Error(`Invalid path: [${trimmedPath}]`);
    if (trimmedPath === '/') return { parent: '', name: '' };
    const pathParts = trimmedPath.split('/'); // split the path apart
    const lastPart = pathParts.at(-1);
    if (lastPart === undefined || lastPart === '') pathParts.pop(); // if the path ended in a "/", remove the blank path part at the end
    const name = pathParts.pop(); // remove leaf of path
    // Unreachable. Every valid path starts with a slash, so split() yields a
    // leading '' plus at least one segment: 3 parts minimum for a non-root path
    // ('/' having returned above), leaving 2 after the trailing-blank pop. So
    // this pop always finds one. A throw rather than a fallback because that
    // guarantee lives in isValidPath(), not here, and loosening it there should
    // fail loudly instead of quietly yielding an empty name.
    if (name === undefined) throw new Error(`Invalid path: [${trimmedPath}]`);
    let parent = pathParts.join('/');
    if (!parent.endsWith('/')) parent += '/';
    if (!parent.startsWith('/')) parent = `/${parent}`;
    return {
        parent,
        name,
    };
}

/**
 * For the given path, return the parent path
 *
 * For example:
 *  - /2001/12-31/image.jpg returns /2001/12-31/
 *  - /2001/12-31/ returns /2001/
 *  - /2001/ returns /
 *  - / returns '' TODO: MAYBE THIS SHOULD BE UNDEFINED
 *
 * Throws on a path that is not valid, including an album path with no
 * trailing slash such as /2001/12-31
 *
 * @param {String} path a path of the format /2001/12-31/image.jpg, or a subset thereof
 * @returns {String} parent path
 */
export function getParentFromPath(path: string): string {
    return getParentAndNameFromPath(path).parent;
}

/**
 * For the given path, return the leaf name
 *
 * For example:
 *  - /2001/12-31/image.jpg returns image.jpg
 *  - /2001/12-31/ returns 12-31
 *  - /2001/ returns 2001
 *  - / returns ''
 *
 * Throws on a path that is not valid, including an album path with no
 * trailing slash such as /2001/12-31
 *
 * @param path a path of the format /2001/12-31/image.jpg, or a subset thereof
 * @returns name of leaf, like image.jpg
 */
export function getNameFromPath(path: string): string {
    return getParentAndNameFromPath(path).name;
}

/**
 * Convert from an album path to a date.
 *
 * @param albumPath path of root, year or day album like / or /2001/ or /2001/12-31/
 */
export function albumPathToDate(albumPath: string): Date {
    if (!isValidAlbumPath(albumPath)) throw new Error(`Invalid album path: [${albumPath}]`);
    if (albumPath === '/') {
        return new Date(1826, 0, 1); // Date of first surviving photograph
    }
    const groups = /^\/(?<year>\d{4})\/(?:(?<month>\d{2})-(?<day>\d{2})\/)?$/v.exec(albumPath)?.groups;
    const yearDigits = groups?.['year'];
    if (groups === undefined || yearDigits === undefined || yearDigits === '') throw new Error(`Error matching`);
    const year = Number(yearDigits);
    const monthDigits = groups['month'];
    const dayDigits = groups['day'];
    if (monthDigits !== undefined && monthDigits !== '' && dayDigits !== undefined && dayDigits !== '') {
        const month = Number(monthDigits) - 1;
        const day = Number(dayDigits);
        return new Date(year, month, day);
    }
    return new Date(year, 0, 1); // Use Jan 1 for year albums
}

/**
 * De-duplicate media paths by appending _2, _3, etc. to duplicates.
 * Preserves the order of the original array.
 *
 * @param mediaPaths array of media paths like /2024/01-01/photo.jpg
 * @returns array with duplicates renamed
 */
export function deduplicateMediaPaths(mediaPaths: string[]): string[] {
    const used = new Set<string>(); // All paths that are used (original or generated)
    const result: string[] = [];

    // First pass: mark all original paths as potentially used
    for (const path of mediaPaths) {
        used.add(path);
    }

    // Track how many times we've seen each original path
    const seenCount = new Map<string, number>();

    for (const path of mediaPaths) {
        const count = seenCount.get(path) ?? 0;
        seenCount.set(path, count + 1);

        if (count === 0) {
            // First occurrence - use as-is
            result.push(path);
        } else {
            // Duplicate - find next available suffix
            const dotIndex = path.lastIndexOf('.');
            const base = path.slice(0, dotIndex);
            const ext = path.slice(dotIndex);

            let suffix = count + 1;
            let newPath = `${base}_${suffix}${ext}`;
            while (used.has(newPath)) {
                suffix++;
                newPath = `${base}_${suffix}${ext}`;
            }
            used.add(newPath);
            result.push(newPath);
        }
    }

    return result;
}
