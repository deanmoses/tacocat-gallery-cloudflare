import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';
import { type MediaChild, albumKey, mediaKey } from 'tacocat-gallery-shared';

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

const THUMBNAIL_SIZE = '200x200';
const DETAIL_SIZE = 1024;

/** The thumbnail the Worker derives from the current original, or null for a media row that has no file yet. */
export function thumbnailUrl(media: MediaChild): string | null {
    return media.versionId === null ? null : `/i${media.path}/${media.versionId}?size=${THUMBNAIL_SIZE}`;
}

/**
 * The image sized for the media page, which for a video is its poster: 1024 on the long side, so a portrait shot is
 * not shrunk to a 1024-wide strip.
 */
export function detailImageUrl(media: MediaChild): string | null {
    if (media.versionId === null) {
        return null;
    }
    const portrait = media.width !== null && media.height !== null && media.height > media.width;
    const size = portrait ? `x${DETAIL_SIZE}` : `${DETAIL_SIZE}`;
    return `/i${media.path}/${media.versionId}?size=${size}`;
}

/** The MP4 the transcoder wrote for a video, beside its poster. */
export function videoUrl(media: MediaChild): string | null {
    return media.versionId === null ? null : `/v/derived${media.path}/${media.versionId}/video.mp4`;
}
