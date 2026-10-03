import type { MediaRecord } from './server';
import type { MediaType, Thumbable, ThumbnailUrlInfo } from '../GalleryItemInterfaces';
import { ThumbableBaseImpl } from './ThumbableBaseImpl';
import { titleFromName } from '$lib/utils/titleUtils';
import { albumTitle } from '$lib/utils/date-utils';
import { parentPathOf } from '@tacocat-gallery/shared';

/**
 * Base class for media thumbables (search results context).
 * For media items within an album context, use MediaBaseImpl instead.
 */
export abstract class MediaThumbableBaseImpl extends ThumbableBaseImpl implements Thumbable {
    protected override readonly json: MediaRecord;

    constructor(json: MediaRecord) {
        super(json);
        this.json = json;
    }

    abstract readonly mediaType: MediaType;

    get title(): string {
        return this.json.title ?? titleFromName(this.json.itemName);
    }

    /** The day the item is from, since a search result is shown away from its album */
    get summary(): string {
        return albumTitle(parentPathOf(this.path));
    }

    get href(): string {
        return this.path;
    }

    get versionId(): string {
        return this.json.versionId;
    }

    get thumbnailUrlInfo(): ThumbnailUrlInfo {
        return {
            imagePath: this.path,
            versionId: this.json.versionId,
            crop: this.json.thumbnail,
        };
    }
}
