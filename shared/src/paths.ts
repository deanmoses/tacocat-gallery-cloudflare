// Gallery paths, as the URL scheme has had them since 2001: the root album is `/`, a year album `/2001/`, a day album
// `/2001/06-15/` and a media item `/2001/06-15/felix.jpg`. Albums end in a slash and media do not. `parsePath` is the
// one reader of a path; everything else about a path is a question asked of what it answers, or a builder.

/** The image formats an upload may have, as the AWS gallery accepted them. */
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'heic', 'heif'] as const;

/** The video formats an upload may have. Which of them the transcoder can read is ffmpeg's business. */
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', '3gp', 'mpg', 'mpeg'] as const;

const YEAR_NAME = /^\d{4}$/u;
const DAY_NAME = /^\d{2}-\d{2}$/u;
const MEDIA_NAME = /^[^./]+\.[^./]+$/u;
const HEIC_NAME = /\.(?:heic|heif)$/iu;
const STRICT_MEDIA_NAME = /^[0-9a-z]+(?:_[0-9a-z]+)*\.[0-9a-z]+$/u;

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
    const baseName = sanitizeMediaBaseName(fileName.slice(0, dot)).replace(/_$/u, '');
    const extension = fileName
        .slice(dot + 1)
        .toLowerCase()
        .replace(/^jpeg$/u, 'jpg');
    return `${baseName}.${extension}`;
}

/**
 * The name half of `sanitizeMediaFilename`, for a name being typed: a trailing underscore stays, since the next
 * character may be coming, and the strict rule refuses it if it is still there when the name is submitted.
 */
export function sanitizeMediaBaseName(baseName: string): string {
    return baseName
        .toLowerCase()
        .replaceAll(/[^0-9_a-z]+/gu, '_')
        .replaceAll(/_+/gu, '_')
        .replace(/^_/u, '');
}

/** The extension of a media name, lowercased and without the dot: `felix.JPG` is `jpg`. */
export function extensionOf(name: string): string {
    return name.slice(name.lastIndexOf('.') + 1).toLowerCase();
}

/** A HEIC, which only Safari can show, so the raw route offers it as a JPEG. */
export function isHeicName(name: string): boolean {
    return HEIC_NAME.test(name);
}

/** A path read: which of the four kinds it is and what the database keys it by. An album stands at a date. */
export type ParsedPath =
    | { kind: 'root' }
    | { kind: 'year'; parentPath: '/'; name: string; date: Date }
    | { kind: 'day'; parentPath: string; name: string; date: Date }
    | { kind: 'media'; parentPath: string; name: string };

/**
 * Reads a gallery path, or answers null for anything that is not one: an album without its slash, a media item outside
 * a day album, a day that is not on the calendar, as `02-30` and `02-29` outside a leap year are not.
 */
export function parsePath(path: string): ParsedPath | null {
    if (path === '/') {
        return { kind: 'root' };
    }
    if (!path.startsWith('/')) {
        return null;
    }
    const [year, day, name, deeper] = path.slice(1).split('/', 4);
    if (year === undefined || !isYearName(year)) {
        return null;
    }
    if (day === '' && name === undefined) {
        return { kind: 'year', parentPath: '/', name: year, date: localDate(Number(year), 1, 1) };
    }
    if (day === undefined || !isDayName(day)) {
        return null;
    }
    const date = calendarDate(year, day);
    if (date === null) {
        return null;
    }
    const parentPath = albumPath('/', year);
    if (name === '' && deeper === undefined) {
        return { kind: 'day', parentPath, name: day, date };
    }
    return name === undefined || deeper !== undefined || !isMediaName(name)
        ? null
        : { kind: 'media', parentPath: albumPath(parentPath, day), name };
}

/** The date `day` names in `year`, or null when the calendar has no such day. */
function calendarDate(year: string, day: string): Date | null {
    const [month = 0, dayOfMonth = 0] = day.split('-').map(Number);
    const date = localDate(Number(year), month, dayOfMonth);
    return date.getFullYear() === Number(year) && date.getMonth() === month - 1 && date.getDate() === dayOfMonth
        ? date
        : null;
}

/** Local midnight on a date, with the year taken as given: the Date constructor would read `50` as 1950. */
function localDate(year: number, month: number, dayOfMonth: number): Date {
    const date = new Date(0);
    date.setFullYear(year, month - 1, dayOfMonth);
    date.setHours(0, 0, 0, 0);
    return date;
}

/** Whether `path` is the root, a year album or a day album. */
export function isAlbumPath(path: string): boolean {
    const kind = parsePath(path)?.kind;
    return kind !== undefined && kind !== 'media';
}

export function isYearAlbumPath(path: string): boolean {
    return parsePath(path)?.kind === 'year';
}

export function isDayAlbumPath(path: string): boolean {
    return parsePath(path)?.kind === 'day';
}

/** Whether `path` is a media item in a day album: `/2001/06-15/felix.jpg`. */
export function isMediaPath(path: string): boolean {
    return parsePath(path)?.kind === 'media';
}

/** How the database identifies an item: the album it is in, and its name there. */
export interface ItemKey {
    parentPath: string;
    itemName: string;
}

/** An album's key: `/2001/06-15/` is `06-15` in `/2001/`. The root has none, and nothing but an album has one. */
export function albumKey(path: string): ItemKey | null {
    const album = parsePath(path);
    return album?.kind === 'year' || album?.kind === 'day'
        ? { parentPath: album.parentPath, itemName: album.name }
        : null;
}

/** A media item's key: `/2001/06-15/felix.jpg` is `felix.jpg` in `/2001/06-15/`. Anything but a media path has none. */
export function mediaKey(path: string): ItemKey | null {
    const media = parsePath(path);
    return media?.kind === 'media' ? { parentPath: media.parentPath, itemName: media.name } : null;
}

/** The album that holds `path`. Throws for the root, which nothing holds, and for anything that is not a path. */
export function parentPathOf(path: string): string {
    const parsed = parsePath(path);
    if (parsed === null || parsed.kind === 'root') {
        throw new Error(`Not a path with a parent: [${path}]`);
    }
    return parsed.parentPath;
}

/** The date a year or day album stands at, a year at its first day. Throws for anything else, the root included. */
export function albumDate(path: string): Date {
    const album = parsePath(path);
    if (album?.kind !== 'year' && album?.kind !== 'day') {
        throw new Error(`Not a year or day album: [${path}]`);
    }
    return album.date;
}

export function albumPath(parentPath: string, itemName: string): string {
    return `${parentPath}${itemName}/`;
}

export function mediaPath(parentPath: string, itemName: string): string {
    return `${parentPath}${itemName}`;
}

/**
 * The gallery path a page's URL names. The app's URLs carry no trailing slash, so an album gets its slash back, and
 * a URL three segments deep is a media item, since nothing in a name says which it is. A deeper URL is no gallery
 * path and comes back as it is.
 */
export function pathOfUrl(pathname: string): string {
    const depth = pathname.split('/').length - 1;
    return depth >= 3 || pathname.endsWith('/') ? pathname : `${pathname}/`;
}

/** The URL of a gallery path in the app, which is the path without an album's trailing slash: the inverse of `pathOfUrl`. */
export function hrefOf(path: string): string {
    return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

// The same rules as SQL, for the database's check constraints, so that what the code refuses the database refuses too,
// and a test holds each pair to the same answers. GLOB patterns have character classes but no repetition, so a
// fixed-width format is spelled out, and D1 refuses a pattern longer than 50 characters, so a longer format is checked
// in pieces. A check whose expression comes out NULL passes, so a rule on a nullable column says it wants a value.

const YEAR_GLOB = '[0-9][0-9][0-9][0-9]';
const DAY_GLOB = '[0-9][0-9]-[0-9][0-9]';
const DAY_ALBUM_PATH_GLOB = `/${YEAR_GLOB}/${DAY_GLOB}/`;
const DAY_ALBUM_PATH_LENGTH = '/2001/06-15/'.length;

/** `isYearName` as SQL. */
export function yearNameSql(column: string): string {
    return `${column} GLOB '${YEAR_GLOB}'`;
}

/** `isDayName` as SQL. */
export function dayNameSql(column: string): string {
    return `${column} GLOB '${DAY_GLOB}'`;
}

/** `column` is the path of a year album: `/2001/`. */
export function yearAlbumPathSql(column: string): string {
    return `${column} GLOB '/${YEAR_GLOB}/'`;
}

/** `isDayAlbumPath` as SQL. */
export function dayAlbumPathSql(column: string): string {
    return `${column} GLOB '${DAY_ALBUM_PATH_GLOB}'`;
}

/**
 * `column` is a media file name: one dot with something on each side, no slash, and not `.jpeg`, since the gallery
 * stores a JPEG as `.jpg` and the sanitizer spells it so before the name reaches a table. That is `isMediaName` with
 * the one extension `isStoredMediaName` also refuses; the extension list itself is not in the constraint.
 */
export function mediaNameSql(column: string): string {
    return `${column} GLOB '?*.?*' AND ${column} NOT GLOB '*.*.*' AND ${column} NOT GLOB '*/*' AND lower(${column}) NOT GLOB '*.jpeg'`;
}

/** `column` is the path of a media item in a day album: `/2001/06-15/felix.jpg`, its name as `mediaNameSql` has it. */
export function mediaPathSql(column: string): string {
    return `${column} IS NOT NULL AND substr(${column}, 1, ${DAY_ALBUM_PATH_LENGTH}) GLOB '${DAY_ALBUM_PATH_GLOB}' AND ${mediaNameSql(`substr(${column}, ${DAY_ALBUM_PATH_LENGTH + 1})`)}`;
}
