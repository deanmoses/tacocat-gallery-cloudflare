import type { Album } from '$lib/models/GalleryItemInterfaces';
import { albumNav } from './albumNavigation';
import { getParentFromPath, isValidAlbumPath, isValidMediaPath } from './galleryPathUtils';

/**
 * Shape of function to retrieve an Album from its path.
 */
type GetAlbumFunction = (path: string) => Album | undefined;

/**
 * Given an arrow key press, return URL of next or previous photo or album to navigate to
 *
 * @param key the key from KeyboardEvent.key
 * @param path path to the current album or media item
 * @returns path of album or media item to navigate to, or null if do not navigate
 */
export function handleKeyboardNavigation(
    key: KeyboardEvent['key'],
    path: string,
    getAlbum: GetAlbumFunction,
): string | null {
    const currentPath = isValidAlbumPath(`${path}/`) ? `${path}/` : path;

    // get URL to navigate to
    let newPath = getUrlToNavigateTo(key, currentPath, getAlbum);

    // make sure there's a / at root
    if (newPath !== null && !newPath.startsWith('/')) {
        newPath = `/${newPath}`;
    }

    return newPath;
}

/**
 * Given an arrow key press, return URL of next or previous photo or album to navigate to
 *
 * @param key the key from KeyboardEvent.key
 * @param path path to the current album or media item
 * @returns path of album or media item to navigate to, or null if do not navigate
 */
function getUrlToNavigateTo(key: KeyboardEvent['key'], path: string, getAlbum: GetAlbumFunction): string | null {
    switch (key) {
        // left arrow: go to previous photo or album
        case 'ArrowLeft':
            return navigateToPeer(path, getAlbum, Direction.PREV);
        // right arrow: go to next photo or album
        case 'ArrowRight':
            return navigateToPeer(path, getAlbum, Direction.NEXT);
        // up arrow: go to parent album
        case 'ArrowUp':
            return navigateToParent(path);
        // down arrow: go to first child photo or child album
        case 'ArrowDown':
            return navigateToFirstChild(path, getAlbum);
        default:
            return null;
    }
}

const Direction = {
    NEXT: 'Next',
    PREV: 'Prev',
} as const;
type Direction = (typeof Direction)[keyof typeof Direction];

/**
 * Return URL to next or prev photo
 *
 * @param path path to the current album or media item
 * @param direction Next or Prev
 * @returns path of album or media item to navigate to, or null if do not navigate
 */
function navigateToPeer(path: string, getAlbum: GetAlbumFunction, direction: Direction): string | null {
    // If on an album, go to prev/next album. Albums are listed oldest first and
    // the site pages through them newest first, so "next" is the older one.
    if (isValidAlbumPath(path)) {
        const nav = albumNav(path, getAlbum(getParentFromPath(path)));
        const newPath = direction === Direction.NEXT ? nav.prevHref : nav.nextHref;
        if (newPath !== undefined && newPath !== '') {
            return newPath;
        }
    }
    // If on a media item, go to prev/next media
    else if (isValidMediaPath(path)) {
        const albumPath: string = getParentFromPath(path);
        const album = getAlbum(albumPath);
        if (album) {
            const media = album.getMedia(path);
            if (media) {
                const newPath = direction === Direction.NEXT ? media.nextHref : media.prevHref;
                if (newPath !== undefined && newPath !== '') {
                    return newPath;
                }
            } else {
                console.log(`Did not find media [${path}] on album [${albumPath}]`);
            }
        } else {
            console.log(`No album found at path: ${path}`);
        }
    } else {
        console.warn(`Path is neither a media item nor an album: ${path}`);
    }

    return null;
}

/**
 * Return URL of parent album
 *
 * @param path path to the current album or media item
 * @returns path of parent album, or null if do not navigate
 */
function navigateToParent(path: string): string | null {
    // If on a media item, navigate to the album containing the media
    if (isValidMediaPath(path)) {
        const albumPath: string = getParentFromPath(path);
        return albumPath;
    }
    // If on an album, navigate to parent album
    else if (isValidAlbumPath(path)) {
        const parentAlbumPath: string = getParentFromPath(path);
        return parentAlbumPath;
    }
    console.warn(`Path is neither a media item nor an album: ${path}`);

    return null;
}

/**
 * If on an album, navigate to first child photo or child album
 *
 * @param path path to the current album or media item
 * @returns path of album or media item to navigate to, or null if do not navigate
 */
function navigateToFirstChild(path: string, getAlbum: GetAlbumFunction): string | null {
    if (isValidAlbumPath(path)) {
        const album = getAlbum(path);
        if (album) {
            // If we're on an album with media items, go to first media item
            const firstMedia = album.media[0];
            if (firstMedia !== undefined) {
                return firstMedia.path;
            }
            // Else we're on an album with no media items, but subalbums.
            // Go to first subalbum.
            const firstAlbum = album.albums[0];
            if (firstAlbum !== undefined) {
                return firstAlbum.path;
            }
        } else {
            console.log(`No album found at path: ${path}`);
        }
    }

    return null;
}
