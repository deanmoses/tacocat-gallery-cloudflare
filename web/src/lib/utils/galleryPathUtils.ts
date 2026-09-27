import {
    IMAGE_EXTENSIONS as SHARED_IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS as SHARED_VIDEO_EXTENSIONS,
} from 'tacocat-gallery-shared';

/** Supported image extensions, the ones the server accepts an upload of */
export const IMAGE_EXTENSIONS: string[] = [...SHARED_IMAGE_EXTENSIONS];

/** Supported video extensions, the ones the server accepts an upload of */
export const VIDEO_EXTENSIONS: string[] = [...SHARED_VIDEO_EXTENSIONS];

/** Pattern matching any valid media extension */
const MEDIA_EXT_PATTERN = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS].sort().join('|');

/** Regex for validating media file extensions */
const VALID_MEDIA_EXT_REGEX = new RegExp(String.raw`^.+\.(?:${MEDIA_EXT_PATTERN})$`, 'iu');

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
 * Return true if specified string is a strictly valid media filename.
 * Must be lower case
 * No hyphens (-) just underscores (_)
 * Must not have a path.
 */
export function isValidMediaNameWithoutExtensionStrict(filename: string): boolean {
    // Pattern: alphanumeric start, then optional groups of (single underscore + alphanumeric)
    // ReDoS-safe because _ and [a-z0-9] are disjoint character classes (no ambiguity)
    // Old vulnerable pattern: /^[a-z0-9]+([a-z0-9_]*[a-z0-9]+)*$/
    return /^[0-9a-z]+(?:_[0-9a-z]+)*$/u.test(filename);
}

/** A year or day album name as typed: digits and single hyphens, which is all either is made of. */
export function sanitizeAlbumName(albumName: string): string {
    return (albumName || '')
        .replaceAll(/[A-Za-z]+/gu, '') // letters to nothing
        .replaceAll(/[^\-0-9]+/gu, '-') // any other invalid chars to -
        .replaceAll(/-+/gu, '-') // multple - to single -
        .replaceAll(/^-/gu, ''); // remove leading -
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
