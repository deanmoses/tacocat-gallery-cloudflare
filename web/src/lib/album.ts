import { error } from '@sveltejs/kit';
import {
    type Album,
    type AlbumChild,
    type MediaChild,
    albumKey,
    mediaKey,
    parentAlbumPath,
    parseAlbum,
} from 'tacocat-gallery-shared';

/** Fetches an album from the Worker on this origin, with the fetch a load function is given. */
export async function loadAlbum(fetch: typeof globalThis.fetch, path: string): Promise<Album> {
    const album = await fetchAlbum(fetch, path);
    if (album === null) {
        error(404, 'No such album');
    }
    return album;
}

async function fetchAlbum(fetch: typeof globalThis.fetch, path: string): Promise<Album | null> {
    const response = await fetch(`/api/album${path}`);
    if (response.status === 404) {
        await response.body?.cancel();
        return null;
    }
    if (!response.ok) {
        error(response.status, `The album could not be loaded (${response.status})`);
    }
    return parseAlbum(await response.json());
}

/**
 * The album that holds the album at `path`, for its prev and next links. Null for the root, and when the parent cannot
 * be had: an unpublished year is not found for a guest who can see its published days, and the page shows without
 * the links either way.
 */
export async function loadParent(fetch: typeof globalThis.fetch, path: string): Promise<Album | null> {
    const parentPath = parentAlbumPath(path);
    if (parentPath === null) {
        return null;
    }
    try {
        return await fetchAlbum(fetch, parentPath);
    } catch {
        return null;
    }
}

/** The albums before and after an album among its parent's children. */
export interface AlbumNav {
    prev: AlbumChild | null;
    next: AlbumChild | null;
}

/**
 * The albums either side of the album at `path` in its parent's children, which the Worker has already cut down to
 * what this viewer may see. An album's own response leaves them out, so that it stays the same when a sibling changes.
 */
export function albumNav(path: string, parent: Album | null): AlbumNav {
    const siblings = (parent?.children ?? []).filter((child): child is AlbumChild => child.itemType === 'album');
    const at = siblings.findIndex((child) => child.path === path);
    return at === -1 ? { prev: null, next: null } : { prev: siblings[at - 1] ?? null, next: siblings[at + 1] ?? null };
}

/** A media item with the album it is in and the album's media either side of it. */
export interface MediaInAlbum {
    album: Album;
    media: MediaChild;
    prev: MediaChild | null;
    next: MediaChild | null;
}

/** Finds a media item in its day album's listing, which is where the album page already has it. */
export async function loadMedia(fetch: typeof globalThis.fetch, path: string): Promise<MediaInAlbum> {
    const key = mediaKey(path);
    if (key === null) {
        error(404, 'No such media');
    }
    const album = await loadAlbum(fetch, key.parentPath);
    const siblings = album.children.filter((child): child is MediaChild => child.itemType !== 'album');
    const at = siblings.findIndex((child) => child.itemName === key.itemName);
    const media = siblings[at];
    if (media === undefined) {
        error(404, 'No such media');
    }
    return { album, media, prev: siblings[at - 1] ?? null, next: siblings[at + 1] ?? null };
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

/** The media item's title, or its file name. */
export function mediaTitle(media: { itemName: string; title: string | null }): string {
    return media.title !== null && media.title !== '' ? media.title : media.itemName;
}
