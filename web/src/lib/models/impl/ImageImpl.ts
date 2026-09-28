import type { ImageRecord } from './server';
import type { Album, Image } from '../GalleryItemInterfaces';
import { MediaBaseImpl } from './MediaBaseImpl';
import { originalUrl } from '@tacocat-gallery/shared';

export class ImageImpl extends MediaBaseImpl implements Image {
    protected override readonly json: ImageRecord;

    constructor(json: ImageRecord, album: Album) {
        super(json, album);
        this.json = json;
    }

    readonly mediaType = 'image';

    get originalUrl(): string {
        return originalUrl(this.json.path, this.json.versionId);
    }

    get originalWidth(): number {
        return this.json.dimensions.width;
    }

    get originalHeight(): number {
        return this.json.dimensions.height;
    }
}
