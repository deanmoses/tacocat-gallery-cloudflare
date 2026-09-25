import type { MediaRecord, Rectangle } from './server';
import type { Album, Media, MediaType, Thumbable, ThumbnailUrlInfo } from '../GalleryItemInterfaces';
import { ThumbableBaseImpl } from './ThumbableBaseImpl';
import { detailImageUrl } from '$lib/utils/config';
import { getDetailHeight, getDetailWidth } from '$lib/utils/dimensionUtils';
import { toTitleFromFilename } from '$lib/utils/titleUtils';

/**
 * Base class for media items (images and videos).
 * Consolidates shared logic for navigation, detail sizing, and album relationship.
 */
export abstract class MediaBaseImpl extends ThumbableBaseImpl implements Media {
    protected override readonly json: MediaRecord;
    readonly #album: Album;

    constructor(json: MediaRecord, album: Album) {
        super(json);
        this.json = json;
        this.#album = album;
    }

    abstract readonly mediaType: MediaType;

    // Thumbable implementations

    get title(): string {
        return this.json.title ?? toTitleFromFilename(this.json.itemName);
    }

    set title(title: string) {
        this.json.title = title;
    }

    readonly summary = '';

    get href(): string {
        return this.path;
    }

    get thumbnailUrlInfo(): ThumbnailUrlInfo {
        return {
            imagePath: this.path,
            versionId: this.json.versionId,
            crop: this.json.thumbnail,
        };
    }

    // Media-specific properties

    get versionId(): string {
        return this.json.versionId;
    }

    get thumbnail(): Rectangle | undefined {
        return this.json.thumbnail;
    }

    get parentTitle(): string {
        return this.#album.title;
    }

    // Detail image/poster sizing

    get detailUrl(): string {
        return detailImageUrl(this.json.path, this.json.versionId, this.json.dimensions);
    }

    get detailWidth(): number {
        return getDetailWidth(this.json.dimensions.width, this.json.dimensions.height);
    }

    get detailHeight(): number {
        return getDetailHeight(this.json.dimensions.width, this.json.dimensions.height);
    }

    // Navigation within album

    get nextHref(): string | undefined {
        return this.#next?.path;
    }

    get prevHref(): string | undefined {
        return this.#prev?.path;
    }

    get nextTitle(): string | undefined {
        return this.#next?.title;
    }

    get prevTitle(): string | undefined {
        return this.#prev?.title;
    }

    get #next(): Thumbable | undefined {
        let foundMyself = false;
        return this.#album.media.find((item) => {
            if (foundMyself) {
                return true;
            }
            if (item.path === this.path) {
                foundMyself = true;
            }
            return false;
        });
    }

    get #prev(): Thumbable | undefined {
        let prev: Thumbable | undefined;
        this.#album.media.find((item) => {
            if (item.path === this.path) {
                return true;
            }
            prev = item;
            return false;
        });
        return prev;
    }
}
