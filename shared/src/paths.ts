// Gallery paths, as the URL scheme has had them since 2001: the root album is `/`, a year album `/2001/`, a day album
// `/2001/06-15/` and a media item `/2001/06-15/felix`. Albums end in a slash and media do not. `parsePath` is the
// one reader of a path; everything else about a path is a question asked of what it answers, or a builder.

/** The image formats an upload may have, as the AWS gallery accepted them. */
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'heic', 'heif'] as const;

/** The video formats an upload may have. Which of them the transcoder can read is ffmpeg's business. */
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', '3gp', 'mpg', 'mpeg'] as const;

/**
 * The content type an upload of each extension is stored with. A type's first extension names a download of it.
 */
const CONTENT_TYPES: Record<(typeof IMAGE_EXTENSIONS)[number] | (typeof VIDEO_EXTENSIONS)[number], string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    heic: 'image/heic',
    heif: 'image/heif',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    webm: 'video/webm',
    m4v: 'video/x-m4v',
    '3gp': 'video/3gpp',
    mpg: 'video/mpeg',
    mpeg: 'video/mpeg',
};

/** The content type of an upload whose file name has `extension`, or null for one the gallery does not take. */
export function contentTypeOf(extension: string): string | null {
    return Object.entries(CONTENT_TYPES).find(([known]) => known === extension)?.[1] ?? null;
}

/** The extension a download of a stored original gets, from its content type; `bin` for a type no upload has. */
export function extensionForType(contentType: string): string {
    return Object.entries(CONTENT_TYPES).find(([, type]) => type === contentType)?.[0] ?? 'bin';
}

const YEAR_NAME = /^\d{4}$/u;
const DAY_NAME = /^\d{2}-\d{2}$/u;
const MEDIA_NAME = /^[0-9a-z]+(?:_[0-9a-z]+)*$/u;
const HEIC_FILE = /\.(?:heic|heif)$/iu;

export function isYearName(name: string): boolean {
    return YEAR_NAME.test(name);
}

/** The shape of a day album's name, `06-15`; whether the calendar has the day is the path's business, since it takes the year. */
export function isDayName(name: string): boolean {
    return DAY_NAME.test(name);
}

/**
 * A media item's name: lowercase letters and digits with single underscores between them, which is what the sanitizer
 * makes of an upload's file name. There is no extension: what kind of file the item is, the database says.
 */
export function isMediaName(name: string): boolean {
    return MEDIA_NAME.test(name);
}

/**
 * The name an uploaded file gets as a media item: the file's name without its extension, lowercased, every run of
 * anything else an underscore, and none at either end. `IMG_0001.HEIC` becomes `img_0001`.
 */
export function sanitizeMediaName(fileName: string): string {
    const dot = fileName.lastIndexOf('.');
    return sanitizeMediaNameAsTyped(dot === -1 ? fileName : fileName.slice(0, dot)).replace(/_$/u, '');
}

/**
 * `sanitizeMediaName` for a name being typed: a trailing underscore stays, since the next character may be coming,
 * and the name rule refuses it if it is still there when the name is submitted.
 */
export function sanitizeMediaNameAsTyped(text: string): string {
    return text
        .toLowerCase()
        .replaceAll(/[^0-9_a-z]+/gu, '_')
        .replaceAll(/_+/gu, '_')
        .replace(/^_/u, '');
}

/**
 * `names` with every repeat given the lowest `_n` that is free, `_2` first, so that two files of one drop or two AWS
 * items that sanitize to one name become two items. The order is kept, and a name a suffix would land on is counted
 * as taken wherever it stands in the list.
 */
export function deduplicateNames(names: readonly string[]): string[] {
    const used = new Set(names);
    const seen = new Map<string, number>();
    return names.map((name) => {
        const count = seen.get(name) ?? 0;
        seen.set(name, count + 1);
        if (count === 0) {
            return name;
        }
        let suffix = count + 1;
        while (used.has(`${name}_${suffix}`)) {
            suffix += 1;
        }
        const renamed = `${name}_${suffix}`;
        used.add(renamed);
        return renamed;
    });
}

/** The extension of an upload's file name, lowercased and without the dot: `felix.JPG` is `jpg`. */
export function extensionOf(fileName: string): string {
    return fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
}

/** Whether an upload's file name says it is a video. */
export function isVideoFile(fileName: string): boolean {
    return (VIDEO_EXTENSIONS as readonly string[]).includes(extensionOf(fileName));
}

/** Whether an upload's file name says it is a HEIC, which only Safari can show. */
export function isHeicFile(fileName: string): boolean {
    return HEIC_FILE.test(fileName);
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

/** Whether `path` is a media item in a day album: `/2001/06-15/felix`. */
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

/**
 * `isDayAlbumPath` as SQL: the shape, and the day on the year's calendar, checked as the timestamps are, by round trip:
 * SQLite's date() gives back the text it was given only for a date that exists.
 */
export function dayAlbumPathSql(column: string): string {
    return `${column} GLOB '${DAY_ALBUM_PATH_GLOB}' AND ${calendarSql(`substr(${column}, 2, 4) || '-' || substr(${column}, 7, 5)`)}`;
}

/** A day album by its key: `parentColumn` is its year's path and `nameColumn` a day on that year's calendar. */
export function dayAlbumKeySql(parentColumn: string, nameColumn: string): string {
    return `${yearAlbumPathSql(parentColumn)} AND ${dayNameSql(nameColumn)} AND ${calendarSql(`substr(${parentColumn}, 2, 4) || '-' || ${nameColumn}`)}`;
}

/** `text`, an SQL expression giving `2001-06-15`, is a day the calendar has. */
function calendarSql(text: string): string {
    return `date(${text}) IS ${text}`;
}

/** `isMediaName` as SQL: lowercase letters and digits, with single underscores between them. */
export function mediaNameSql(column: string): string {
    return `${column} GLOB '[0-9a-z]*' AND ${column} NOT GLOB '*[^0-9a-z_]*' AND ${column} NOT GLOB '*__*' AND ${column} NOT GLOB '*_'`;
}

/** `isMediaPath` as SQL: `column` is the path of a media item in a day album: `/2001/06-15/felix`. */
export function mediaPathSql(column: string): string {
    return `${column} IS NOT NULL AND ${dayAlbumPathSql(`substr(${column}, 1, ${DAY_ALBUM_PATH_LENGTH})`)} AND ${mediaNameSql(`substr(${column}, ${DAY_ALBUM_PATH_LENGTH + 1})`)}`;
}
