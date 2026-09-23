import { error } from '@sveltejs/kit';
import { type Album, albumKey, parseAlbum } from 'tacocat-gallery-shared';

/** Fetches an album from the Worker on this origin, with the fetch a load function is given. */
export async function loadAlbum(fetch: typeof globalThis.fetch, path: string): Promise<Album> {
    const response = await fetch(`/api/album${path}`);
    if (response.status === 404) {
        error(404, 'No such album');
    }
    if (!response.ok) {
        error(response.status, `The album could not be loaded (${String(response.status)})`);
    }
    return parseAlbum(await response.json());
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
});

/** The album's own title, or the one its path implies: the year for a year album, the date for a day album. */
export function albumTitle(album: { path: string; title: string | null }): string {
    if (album.title !== null && album.title !== '') {
        return album.title;
    }
    const key = albumKey(album.path);
    if (key === null) {
        return 'Tacocat Gallery';
    }
    if (key.parentPath === '/') {
        return key.itemName;
    }
    const [month = '', day = ''] = key.itemName.split('-', 2);
    const year = key.parentPath.slice(1, -1);
    return DAY_FORMAT.format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))));
}
