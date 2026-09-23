import type { ImageRecord } from './server';
import { MediaThumbableBaseImpl } from './MediaThumbableBaseImpl';

export class ImageThumbableImpl extends MediaThumbableBaseImpl {
    protected override readonly json: ImageRecord;

    constructor(json: ImageRecord) {
        super(json);
        this.json = json;
    }

    readonly mediaType = 'image';
}
