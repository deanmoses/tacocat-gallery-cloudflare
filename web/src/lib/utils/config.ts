import type { Rectangle } from '$lib/models/impl/server';
import type { SearchQuery } from '$lib/models/search';
import {
    API,
    type Size,
    THUMBNAIL_SIZE,
    THUMBNAIL_SIZE_2X,
    apiUrl,
    detailSize,
    imageUrl,
} from '@tacocat-gallery/shared';

/**
 * URL to CDN'ed thumbnail images
 * @param mediaPath Path to the source media like /2001/12-31/image.jpg or /2001/12-31/video.mp4
 * @param versionId Version of the source media
 * @param crop Optional crop rectangle
 */
export function thumbnailUrl(mediaPath: string, versionId: string, crop?: Rectangle): string {
    return imageUrl({ path: mediaPath, versionId, size: THUMBNAIL_SIZE, crop: crop ?? null });
}

/**
 * The thumbnail's `srcset`: the same frame at one and two device pixels per CSS pixel, so a Retina screen draws it
 * pixel for pixel instead of upscaling the smaller one
 * @param mediaPath Path to the source media like /2001/12-31/image.jpg or /2001/12-31/video.mp4
 * @param versionId Version of the source media
 * @param crop Optional crop rectangle
 */
export function thumbnailSrcset(mediaPath: string, versionId: string, crop?: Rectangle): string {
    const larger = imageUrl({ path: mediaPath, versionId, size: THUMBNAIL_SIZE_2X, crop: crop ?? null });
    return `${thumbnailUrl(mediaPath, versionId, crop)} 1x, ${larger} 2x`;
}

/**
 * URL to image optimized for display on the media detail page
 * @param mediaPath Path to the source media like /2001/12-31/image.jpg or /2001/12-31/video.mp4
 * @param versionId Version of the source media
 * @param dimensions Size of the source media, from which the detail size follows
 */
export function detailImageUrl(mediaPath: string, versionId: string, dimensions: Size): string {
    return imageUrl({ path: mediaPath, versionId, size: detailSize(dimensions), crop: null });
}

/**
 * URL to send HTTP GET to search for the specified terms
 */
export function searchUrl(query: SearchQuery, startAt: number, pageSize: number): string {
    const params: string[] = [];
    if (query.oldestYear !== undefined) params.push(`oldest=${query.oldestYear}`);
    if (query.newestYear !== undefined) params.push(`newest=${query.newestYear}`);
    if (query.oldestFirst === true) params.push('oldestFirst=true');
    if (startAt !== 0) params.push(`startAt=${startAt}`);
    if (pageSize !== 0) params.push(`pageSize=${pageSize}`);
    return `${apiUrl(API.search, `/${encodeURIComponent(query.terms)}`)}?${params.join('&')}`;
}

/**
 * Relative URL to the search page within the Sveltekit app
 */
export function localSearchUrl(query: SearchQuery, returnPath: string): string {
    const params: string[] = [];
    params.push(`returnPath=${encodeURIComponent(returnPath)}`);
    if (query.oldestYear !== undefined) params.push(`oldest=${query.oldestYear}`);
    if (query.newestYear !== undefined) params.push(`newest=${query.newestYear}`);
    if (query.oldestFirst === true) params.push('oldestFirst=true');
    return `/search/${encodeURIComponent(ensureDumbQuotes(query.terms))}?${params.join('&')}`;
}

/**
 * Phones insert smart quotes. The search reads those as quotes too, but the URL is plainer with dumb ones.
 */
function ensureDumbQuotes(searchTerms: string): string {
    return searchTerms.replaceAll(/[‘’]/gu, "'").replaceAll(/[“”]/gu, '"');
}

/**
 * The title of the site, such as shown in the header of the site.
 */
export function siteTitle(): string {
    return 'Dean, Lucie, Felix and Milo Moses';
}

/**
 * The shorter title of the site, to be shown when space is limited.
 */
export function siteShortTitle(): string {
    return 'The Moses Family';
}
