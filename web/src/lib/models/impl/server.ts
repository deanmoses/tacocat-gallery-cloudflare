//
// THESE TYPES ARE WHAT COMES FROM THE SERVER
// AND WHAT ARE STORED ON LOCAL DISK
//
// Their shapes live in shared/, where the Worker builds them.

import type { AlbumRecord, GalleryRecord, ImageRecord, MediaRecord, VideoRecord } from 'tacocat-gallery-shared';

export type {
    AlbumGalleryItem,
    AlbumRecord,
    GalleryRecord,
    ImageRecord,
    MediaRecord,
    Rectangle,
    VideoRecord,
} from 'tacocat-gallery-shared';

//
// TYPE GUARDS
//

export function isAlbumRecord(record: GalleryRecord): record is AlbumRecord {
    return record.itemType === 'album';
}

export function isMediaRecord(record: GalleryRecord): record is MediaRecord {
    return record.itemType === 'media';
}

export function isVideoRecord(record: GalleryRecord): record is VideoRecord {
    return isMediaRecord(record) && record.mediaType === 'video';
}

export function isImageRecord(record: GalleryRecord): record is ImageRecord {
    return isMediaRecord(record) && record.mediaType === 'image';
}
