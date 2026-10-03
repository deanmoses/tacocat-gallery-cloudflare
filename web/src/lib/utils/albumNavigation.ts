import type { Album, Media } from '$lib/models/GalleryItemInterfaces';
import { albumTitle } from './date-utils';

/** Where an album page's prev and next buttons lead */
export interface AlbumNav {
    prevHref: string | undefined;
    nextHref: string | undefined;
    prevTitle: string | undefined;
    nextTitle: string | undefined;
}

/**
 * An album's neighbours are the children on either side of it in its parent.
 * The server has already filtered the parent's child list to what this viewer
 * may see, so an unpublished album is a neighbour to an admin and skipped over
 * for a guest. Without the parent there are no neighbours, which leaves the
 * buttons disabled until it arrives.
 */
export function albumNav(albumPath: string, parent: Album | undefined): AlbumNav {
    const siblings = parent?.albums ?? [];
    const index = siblings.findIndex((sibling) => sibling.path === albumPath);
    const prev = index === -1 ? undefined : siblings[index - 1];
    const next = index === -1 ? undefined : siblings[index + 1];
    return {
        prevHref: prev?.href,
        nextHref: next?.href,
        prevTitle: prev ? albumTitle(prev.path, 'short') : undefined,
        nextTitle: next ? albumTitle(next.path, 'short') : undefined,
    };
}

/** The media item at a path in an album, if the album is loaded */
export function getMedia(album: Album | undefined, mediaPath: string): Media | undefined {
    return album?.media.find((media) => media.path === mediaPath);
}

/** The media on either side of a media item, in the order its album shows them */
export function mediaNeighbours(album: Album, mediaPath: string): { prev: Media | undefined; next: Media | undefined } {
    const index = album.media.findIndex((media) => media.path === mediaPath);
    return index === -1
        ? { prev: undefined, next: undefined }
        : { prev: album.media[index - 1], next: album.media[index + 1] };
}
