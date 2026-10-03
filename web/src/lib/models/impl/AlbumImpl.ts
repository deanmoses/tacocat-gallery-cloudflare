import { hrefOf, parsePath } from '@tacocat-gallery/shared';
import type { AlbumGalleryItem, GalleryRecord } from './server';
import { isAlbumRecord, isMediaRecord } from './server';
import type { Album, Media, Thumbable, ThumbnailUrlInfo } from '../GalleryItemInterfaces';
import { ThumbableBaseImpl } from './ThumbableBaseImpl';
import { toMedia } from './GalleryItemCreator';
import { albumTitle } from '$lib/utils/date-utils';

export class AlbumImpl extends ThumbableBaseImpl implements Album {
    override readonly json: AlbumGalleryItem;
    readonly #kind: 'root' | 'year' | 'day';

    constructor(json: AlbumGalleryItem) {
        super(json);
        this.json = json;
        const kind = parsePath(json.path)?.kind;
        if (kind === undefined || kind === 'media') throw new Error(`Invalid album path [${json.path}]`);
        this.#kind = kind;
    }

    get title(): string {
        return this.#kind === 'root' ? '' : albumTitle(this.path);
    }

    /** Only a day album has a parent with a title: the root has no parent, and a year's parent is the root */
    get parentTitle(): string {
        return this.#kind === 'day' ? albumTitle(this.parentPath) : '';
    }

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
        return this.json.children?.filter(isAlbumRecord).map((record) => new AlbumImpl(record)) ?? [];
    }

    getMedia(mediaPath: string): Media | undefined {
        const record = this.json.children?.find((child: GalleryRecord) => child.path === mediaPath);
        return !record || !isMediaRecord(record) ? undefined : toMedia(record, this);
    }
}
