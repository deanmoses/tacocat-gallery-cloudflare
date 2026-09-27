import type { Rectangle } from '$lib/models/impl/server';
import type { SearchQuery } from '$lib/models/search';
import {
    type Size,
    THUMBNAIL_SIZE,
    THUMBNAIL_SIZE_2X,
    detailSize,
    imageUrl,
    isAlbumPath,
    isMediaPath,
} from 'tacocat-gallery-shared';

/**
 * The API, the media and the login are all served by the Worker on the site's own origin, so every URL is a path.
 */
function baseApiUrl(): string {
    return '/api/';
}

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
 * URL to check for media processing errors
 */
export function mediaErrorsUrl(): string {
    return `${baseApiUrl()}errors`;
}

/**
 * URL of an album: GET reads it, HEAD asks whether it is there, PUT makes it
 */
export function albumUrl(path: string): string {
    if (!isAlbumPath(path)) throw new Error(`Invalid album path [${path}]`);
    return `${baseApiUrl()}album${path}`;
}

/**
 * URL of an album or media item as a write names it: PATCH changes it, DELETE removes it
 * @param path path of album or media item
 */
export function itemUrl(path: string): string {
    return baseApiUrl() + (isMediaPath(path) ? 'media' : 'album') + path;
}

/**
 * URL to send HTTP PATCH to set album thumbnail
 * @param albumPath path to an album like /2001/12-31/
 */
export function setThumbnailUrl(albumPath: string): string {
    return `${baseApiUrl()}album-thumb${albumPath}`;
}

/**
 * URL to send HTTP PUT to put an album's media in an order of the admin's, and DELETE to put it back in name order
 * @param albumPath path to a day album like /2001/12-31/
 */
export function albumOrderUrl(albumPath: string): string {
    return `${baseApiUrl()}album-order${albumPath}`;
}

/**
 * URL to send HTTP POST to generate presigned upload URLs
 * @param albumPath path to an album like /2001/12-31/
 */
export function getPresignedUploadUrlGenerationUrl(albumPath: string): string {
    return `${baseApiUrl()}presigned${albumPath}`;
}

/**
 * URL to send HTTP PATCH to recrop a media thumbnail
 * @param mediaPath path to media like /2001/12-31/image.jpg or /2001/12-31/video.mp4
 */
export function recropThumbnailUrl(mediaPath: string): string {
    return `${baseApiUrl()}thumb${mediaPath}`;
}

/**
 * URL to send HTTP POST to rename an album
 * @param albumPath path to an album like /2001/12-31/
 */
export function renameAlbumUrl(albumPath: string): string {
    return `${baseApiUrl()}album-rename${albumPath}`;
}

/**
 * URL to send HTTP POST to rename a media item (image or video)
 * @param mediaPath path to media like /2001/12-31/image.jpg or /2001/12-31/video.mp4
 */
export function renameMediaUrl(mediaPath: string): string {
    return `${baseApiUrl()}media-rename${mediaPath}`;
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
    return `${baseApiUrl()}search/${encodeURIComponent(query.terms)}?${params.join('&')}`;
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
 * URL to check user's authentication status
 */
export function checkAuthenticationUrl(): string {
    return `${baseApiUrl()}auth/status`;
}

/**
 * URL to send HTTP POST to for one step of logging in, creating a passkey or logging out
 */
export function authUrl(
    step: 'invite' | 'register/options' | 'register/verify' | 'login/options' | 'login/verify' | 'logout',
): string {
    return `${baseApiUrl()}auth/${step}`;
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
