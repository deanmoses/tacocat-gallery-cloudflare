import { albumTitle } from '$lib/utils/date-utils';
import { AlbumBaseImpl } from './AlbumBaseImpl';
import type { Album } from '../GalleryItemInterfaces';

export class AlbumDayImpl extends AlbumBaseImpl implements Album {
    get title(): string {
        return albumTitle(this.path);
    }

    get parentTitle(): string {
        return albumTitle(this.json.parentPath);
    }
}
