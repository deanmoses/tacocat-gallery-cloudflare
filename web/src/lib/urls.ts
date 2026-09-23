import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';
import {
    type ImageSize,
    type MediaChild,
    type Thumbnail,
    albumKey,
    imageUrl,
    mediaKey,
    videoUrl,
} from 'tacocat-gallery-shared';

/** The page for an album, from its gallery path: `/2001/06-15/` is shown at `/2001/06-15`. */
export function albumHref(path: string): ResolvedPathname {
    const key = albumKey(path);
    if (key === null) {
        return resolve('/');
    }
    return key.parentPath === '/'
        ? resolve('/[year=year]', { year: key.itemName })
        : resolve('/[year=year]/[day=day]', { year: key.parentPath.slice(1, -1), day: key.itemName });
}

/** The page for a media item, from its gallery path, which is also its URL. */
export function mediaHref(path: string): ResolvedPathname {
    const key = mediaKey(path);
    const day = key === null ? null : albumKey(key.parentPath);
    if (key === null || day === null) {
        return resolve('/');
    }
    return resolve('/[year=year]/[day=day]/[media=media]', {
        year: day.parentPath.slice(1, -1),
        day: day.itemName,
        media: key.itemName,
    });
}

const THUMBNAIL_SIZE: ImageSize = { width: 200, height: 200 };
const DETAIL_SIDE = 1024;

/** A media item as its own thumbnail. */
export function ownThumbnail(media: MediaChild): Thumbnail {
    return { path: media.path, versionId: media.versionId, crop: media.thumbnailCrop };
}

/** The square the Worker cuts and derives from the current original, or null for a media row that has no file yet. */
export function thumbnailUrl({ path, versionId, crop }: Thumbnail): string | null {
    return versionId === null ? null : imageUrl({ path, versionId, size: THUMBNAIL_SIZE, crop });
}

/**
 * The image sized for the media page, which for a video is its poster: 1024 on the long side, so a portrait shot is
 * not shrunk to a 1024-wide strip.
 */
export function detailImageUrl({ path, versionId, width, height }: MediaChild): string | null {
    if (versionId === null) {
        return null;
    }
    const portrait = width !== null && height !== null && height > width;
    const size: ImageSize = portrait ? { width: null, height: DETAIL_SIDE } : { width: DETAIL_SIDE, height: null };
    return imageUrl({ path, versionId, size, crop: null });
}

/** The MP4 the transcoder wrote for a video, beside its poster. */
export function mediaVideoUrl({ path, versionId }: MediaChild): string | null {
    return versionId === null ? null : videoUrl(path, versionId);
}
