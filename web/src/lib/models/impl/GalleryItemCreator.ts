import type { BaseMedia, Image, Media, Video } from '../GalleryItemInterfaces';
import type { ImageRecord, MediaRecord, VideoRecord } from './server';
import { isImageRecord, isVideoRecord } from './server';
import { detailImageUrl } from '$lib/utils/config';
import { detailDimensions } from '$lib/utils/dimensionUtils';
import { titleFromName } from '$lib/utils/titleUtils';
import { originalUrl } from '@tacocat-gallery/shared';

/**
 * The image or video a component reads, from its record
 * @param record Media record from server or stored in idb
 */
export function toMedia(record: MediaRecord): Media {
    if (isVideoRecord(record)) return toVideo(record);
    if (isImageRecord(record)) return toImage(record);
    throw new Error(`Unknown media type: ${JSON.stringify(record)}`);
}

function toImage(record: ImageRecord): Image {
    return {
        ...mediaFields(record),
        mediaType: 'image',
        originalUrl: originalUrl(record.path, record.versionId),
        originalWidth: record.dimensions.width,
        originalHeight: record.dimensions.height,
    };
}

function toVideo(record: VideoRecord): Video {
    return { ...mediaFields(record), mediaType: 'video', duration: record.duration };
}

function mediaFields(record: MediaRecord): BaseMedia {
    const detail = detailDimensions(record.dimensions);
    return {
        path: record.path,
        itemType: 'media',
        title: record.title ?? titleFromName(record.itemName),
        description: record.description ?? '',
        summary: '',
        thumbnailUrlInfo: { imagePath: record.path, versionId: record.versionId, crop: record.thumbnail },
        href: record.path,
        versionId: record.versionId,
        thumbnail: record.thumbnail,
        detailUrl: detailImageUrl(record.path, record.versionId, record.dimensions),
        detailWidth: detail.width,
        detailHeight: detail.height,
    };
}
