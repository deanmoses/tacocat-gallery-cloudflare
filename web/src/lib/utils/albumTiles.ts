import type { UploadEntry } from '$lib/models/album';
import type { Album, Media } from '$lib/models/GalleryItemInterfaces';

/** A thumbnail on a day album's page: a media item, or a file uploading to it */
export type AlbumTile =
    { kind: 'media'; path: string; media: Media } | { kind: 'upload'; path: string; upload: UploadEntry };

/**
 * The album's media with its uploads where the server will put them, so an upload's thumbnail is already where the
 * item will show and the page does not shift as each one lands. That is in name order among the media, or in name order
 * at the end of an album an admin has put in an order of their own. An upload replacing an item shows in its place.
 *
 * In a reordered album the server puts a new item in name order among the media the admin has not placed, which the
 * album does not mark. That is the end unless something was uploaded since the last reorder, and then the item moves
 * when it lands.
 */
export function albumTiles(album: Album, uploads: UploadEntry[]): AlbumTile[] {
    const uploading = new Map(uploads.map((upload) => [upload.path, upload]));
    const tiles: AlbumTile[] = album.media.map((media) => {
        const upload = uploading.get(media.path);
        uploading.delete(media.path);
        return upload ? { kind: 'upload', path: media.path, upload } : { kind: 'media', path: media.path, media };
    });
    // The server sorts by name byte by byte, which is how `<` compares the letters, digits and underscores of a name
    const arriving: AlbumTile[] = [...uploading.values()]
        .map((upload): AlbumTile => ({ kind: 'upload', path: upload.path, upload }))
        .sort(byPath);
    return album.reordered ? [...tiles, ...arriving] : [...tiles, ...arriving].sort(byPath);
}

function byPath(first: AlbumTile, second: AlbumTile): number {
    if (first.path === second.path) return 0;
    return first.path < second.path ? -1 : 1;
}
