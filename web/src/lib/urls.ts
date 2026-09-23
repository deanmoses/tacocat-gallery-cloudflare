import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';
import { type MediaChild, albumKey } from 'tacocat-gallery-shared';

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

const THUMBNAIL_SIZE = '200x200';

/** The thumbnail the Worker derives from the current original, or null for a media row that has no file yet. */
export function thumbnailUrl(media: MediaChild): string | null {
    return media.versionId === null ? null : `/i${media.path}/${media.versionId}?size=${THUMBNAIL_SIZE}`;
}
