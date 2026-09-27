import { albumTitle } from '$lib/utils/date-utils';
import { AlbumBaseImpl } from './AlbumBaseImpl';
import type { Album } from '../GalleryItemInterfaces';

export class AlbumYearImpl extends AlbumBaseImpl implements Album {
    override get title(): string {
        return albumTitle(this.path);
    }

    /** Never used but required to exist */
    readonly parentTitle = '';
}
