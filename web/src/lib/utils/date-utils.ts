import { parsePath } from '@tacocat-gallery/shared';

export function shortDate(d: Date): string {
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric' });
}

function longDate(d: Date): string {
    return d.toLocaleString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

/** A year album is titled by its year and a day album by its date, in full or, where space is short, without the year. */
export function albumTitle(path: string, form: 'long' | 'short' = 'long'): string {
    const album = parsePath(path);
    if (album?.kind === 'year') {
        return album.name;
    }
    if (album?.kind === 'day') {
        return form === 'long' ? longDate(album.date) : shortDate(album.date);
    }
    throw new Error(`Not a year or day album: [${path}]`);
}
