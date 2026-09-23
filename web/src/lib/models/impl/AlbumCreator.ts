import { AlbumType } from '$lib/models/album';
import { getAlbumType } from '$lib/utils/path-utils';
import { AlbumDayImpl } from './AlbumDayImpl';
import type { Album } from '../GalleryItemInterfaces';
import { AlbumRootImpl } from './AlbumRootImpl';
import { AlbumYearImpl } from './AlbumYearImpl';
import type { AlbumRecord } from './server';

/**
 * Instantiate an Album or a subclass of Album from the specified object
 * @param json JSON object coming from server or stored in idb
 */
export default function toAlbum(json: AlbumRecord): Album {
    const { path } = json;
    if (!path) throw new Error(`JSON has no path`);
    const type = getAlbumType(path);
    switch (type) {
        case AlbumType.ROOT:
            return new AlbumRootImpl(json);
        case AlbumType.YEAR:
            return new AlbumYearImpl(json);
        case AlbumType.DAY:
            return new AlbumDayImpl(json);
        default:
            throw new Error(`Unexpected album type for [${path}]`);
    }
}
