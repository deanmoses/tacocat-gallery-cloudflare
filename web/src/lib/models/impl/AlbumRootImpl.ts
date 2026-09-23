import { AlbumBaseImpl } from './AlbumBaseImpl';
import type { Album } from '../GalleryItemInterfaces';

export class AlbumRootImpl extends AlbumBaseImpl implements Album {
    readonly title = '';
    readonly parentTitle = '';
}
