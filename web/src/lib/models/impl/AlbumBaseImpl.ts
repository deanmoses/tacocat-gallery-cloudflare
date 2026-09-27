import { hrefOf } from 'tacocat-gallery-shared';
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

    override set published(published: boolean) {
        this.json.published = published;
    }

    override get summary(): string {
        return this.json.summary ?? '';
    }
    override set summary(summary: string) {
        this.json.summary = summary;
    }

    get href(): string {
        return hrefOf(this.path);
    }

    get thumbnailPath(): string | undefined {
        return this.json.thumbnail?.path;
    }

    set thumbnailPath(imagePath: string | undefined) {
        if (imagePath === undefined) {
            this.json.thumbnail = undefined;
            return;
        }
        // TODO: fix TypeScript error - thumbnail.versionId is required
        // The Drafts system should probably not be saving to this object,
        // but instead some intermediate object...
        // @ts-expect-error Incomplete thumbnail - versionId set by server
        this.json.thumbnail = {
            path: imagePath,
        };
    }

    get thumbnailUrlInfo(): ThumbnailUrlInfo | undefined {
        const { thumbnail } = this.json;
        if (thumbnail === undefined) {
            return undefined;
        }
        // A thumbnail the thumbnailPath setter has put here has no versionId yet, whatever its type says.
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
