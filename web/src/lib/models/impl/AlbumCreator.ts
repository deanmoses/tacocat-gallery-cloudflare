import { hrefOf, parsePath } from '@tacocat-gallery/shared';
import type { Album, ThumbnailUrlInfo } from '../GalleryItemInterfaces';
import { isAlbumRecord, isMediaRecord } from './server';
import type { AlbumGalleryItem } from './server';
import { toMedia } from './GalleryItemCreator';
import { albumTitle } from '$lib/utils/date-utils';

/**
 * The album a component reads, from the record the server sent or the disk cache kept
 * @param json JSON object coming from server or stored in idb
 */
export default function toAlbum(json: AlbumGalleryItem): Album {
    const parsed = parsePath(json.path);
    if (parsed === null || parsed.kind === 'media') throw new Error(`Invalid album path [${json.path}]`);
    const { kind } = parsed;
    return {
        path: json.path,
        itemType: 'album',
        title: kind === 'root' ? '' : albumTitle(json.path),
        description: json.description ?? '',
        summary: json.summary ?? '',
        published: json.published ?? false,
        thumbnailUrlInfo: thumbnailUrlInfo(json),
        href: hrefOf(json.path),
        thumbnailPath: json.thumbnail?.path,
        reordered: json.order ?? false,
        json,
        parentHref: hrefOf(json.parentPath),
        // Only a day album has a parent with a title: the root has no parent, and a year's parent is the root
        parentTitle: parsed.kind === 'day' ? albumTitle(parsed.parentPath) : '',
        media: json.children?.filter(isMediaRecord).map(toMedia) ?? [],
        albums: json.children?.filter(isAlbumRecord).map(toAlbum) ?? [],
    };
}

function thumbnailUrlInfo({ thumbnail }: AlbumGalleryItem): ThumbnailUrlInfo | undefined {
    return thumbnail === undefined || thumbnail.path === '' || thumbnail.versionId === ''
        ? undefined
        : { imagePath: thumbnail.path, versionId: thumbnail.versionId, crop: thumbnail.crop };
}
