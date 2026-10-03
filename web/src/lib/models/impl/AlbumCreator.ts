import type { Album } from '../GalleryItemInterfaces';
import { AlbumImpl } from './AlbumImpl';
import type { AlbumRecord } from './server';

/**
 * Instantiate an Album from the specified object
 * @param json JSON object coming from server or stored in idb
 */
export default function toAlbum(json: AlbumRecord): Album {
    return new AlbumImpl(json);
}
