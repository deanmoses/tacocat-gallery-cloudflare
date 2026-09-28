import { parsePath } from '@tacocat-gallery/shared';
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
    const kind = parsePath(path)?.kind;
    if (kind === 'root') return new AlbumRootImpl(json);
    if (kind === 'year') return new AlbumYearImpl(json);
    if (kind === 'day') return new AlbumDayImpl(json);
    throw new Error(`Invalid album path [${path}]`);
}
