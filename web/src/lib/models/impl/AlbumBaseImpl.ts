import { hrefOf } from '@tacocat-gallery/shared';
import type { AlbumGalleryItem, GalleryRecord } from './server';
import { isAlbumRecord, isMediaRecord } from './server';
import type { Album, Media, Thumbable, ThumbnailUrlInfo } from '../GalleryItemInterfaces';
import { ThumbableBaseImpl } from './ThumbableBaseImpl';
import toAlbum from './AlbumCreator';
import { toMedia } from './GalleryItemCreator';

export abstract class AlbumBaseImpl extends ThumbableBaseImpl implements Album {
    override readonly json: AlbumGalleryItem;

    constructor(json: AlbumGalleryItem) {
        super(json);
        this.json = json;
    }

    abstract readonly parentTitle: string;

    override get published(): boolean {
        return this.json.published ?? false;
    }

    override get summary(): string {
        return this.json.summary ?? '';
    }

    get reordered(): boolean {
        return this.json.order ?? false;
    }

    get href(): string {
        return hrefOf(this.path);
    }

    get thumbnailPath(): string | undefined {
        return this.json.thumbnail?.path;
    }

    get thumbnailUrlInfo(): ThumbnailUrlInfo | undefined {
        const { thumbnail } = this.json;
        if (thumbnail === undefined) {
            return undefined;
        }
        return thumbnail.path && thumbnail.versionId
            ? {
                  imagePath: thumbnail.path,
                  versionId: thumbnail.versionId,
                  crop: thumbnail.crop,
              }
            : undefined;
    }

    get media(): Media[] {
        return this.json.children?.filter(isMediaRecord).map((record) => toMedia(record, this)) ?? [];
    }

    get albums(): Thumbable[] {
        return this.json.children?.filter(isAlbumRecord).map((record) => toAlbum(record)) ?? [];
    }

    getMedia(mediaPath: string): Media | undefined {
        const record = this.json.children?.find((child: GalleryRecord) => child.path === mediaPath);
        return !record || !isMediaRecord(record) ? undefined : toMedia(record, this);
    }
}
