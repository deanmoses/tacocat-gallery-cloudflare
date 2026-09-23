// Gallery paths, as the URL scheme has had them since 2001: the root album is `/`, a year album `/2001/`, a day album
// `/2001/06-15/` and a media item `/2001/06-15/felix.jpg`. Albums end in a slash and media do not.

const YEAR_NAME = /^\d{4}$/v;
const DAY_NAME = /^\d{2}-\d{2}$/v;

export function isYearName(name: string): boolean {
    return YEAR_NAME.test(name);
}

export function isDayName(name: string): boolean {
    return DAY_NAME.test(name);
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

export interface AlbumKey {
    parentPath: string;
    itemName: string;
}

/** An album's database key: `/2001/06-15/` is `06-15` in `/2001/`. The root has none. */
export function albumKey(path: string): AlbumKey | null {
    if (path === '/') {
        return null;
    }
    const cut = path.lastIndexOf('/', path.length - 2);
    return { parentPath: path.slice(0, cut + 1), itemName: path.slice(cut + 1, -1) };
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
export function albumsEnclosing(path: string): AlbumKey[] {
    const key = isAlbumPath(path) ? albumKey(path) : null;
    return key === null ? [] : [...albumsEnclosing(key.parentPath), key];
}
