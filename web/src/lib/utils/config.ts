import type { Rectangle } from '$lib/models/impl/server';
import { isValidAlbumPath, isValidMediaPath } from './galleryPathUtils';
import type { SearchQuery } from '$lib/models/search';
import { type ImageSize, imageUrl, originalUrl, videoUrl } from 'tacocat-gallery-shared';

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
    return imageUrl({ path: mediaPath, versionId, size: { width: 200, height: 200 }, crop: crop ?? null });
}

/**
 * URL to image optimized for display on the media detail page
 * @param mediaPath Path to the source media like /2001/12-31/image.jpg or /2001/12-31/video.mp4
 * @param versionId Version of the source media
 * @param size size like '1024' (landscape) or 'x1024' (portrait)
 */
export function detailImageUrl(mediaPath: string, versionId: string, size: string): string {
    const imageSize: ImageSize = size.startsWith('x')
        ? { width: null, height: Number(size.slice(1)) }
        : { width: Number(size), height: null };
    return imageUrl({ path: mediaPath, versionId, size: imageSize, crop: null });
}

/**
 * URL to view the full sized original raw media.
 * For some formats (like video), this may not be displayable in a browser.
 * @param mediaPath path to media like /2001/12-31/image.jpg or /2001/12-31/video.mp4
 * @param versionId Version of the media
 */
export function originalMediaUrl(mediaPath: string, versionId: string): string {
    return originalUrl(mediaPath, versionId);
}

/**
 * URL to stream a video
 * @param path Path to video like /2001/12-31/video.mp4
 * @param versionId Version of the video
 */
export function videoPlaybackUrl(path: string, versionId: string): string {
    return videoUrl(path, versionId);
}

/**
 * URL to check for media processing errors
 */
export function mediaErrorsUrl(): string {
    return baseApiUrl() + 'errors';
}

/**
 * URL to retrieve an album
 */
export function albumUrl(path: string): string {
    if (!isValidAlbumPath(path)) throw new Error(`Invalid album path [${path}]`);
    return baseApiUrl() + 'album' + path;
}

/**
 * URL to send HTTP PUT to create an album
 * @param path path of album to create
 */
export function createAlbumUrl(path: string): string {
    return baseApiUrl() + 'album' + path;
}

/**
 * URL to send HTTP PATCH to update an album or media item
 * @param path path of album or media item
 */
export function updateUrl(path: string): string {
    return baseApiUrl() + (isValidMediaPath(path) ? 'media' : 'album') + path;
}

/**
 * URL to send HTTP DELETE to delete an album or media item
 * @param path path of album or media item
 */
export function deleteUrl(path: string): string {
    return baseApiUrl() + (isValidMediaPath(path) ? 'media' : 'album') + path;
}

/**
 * URL to send HTTP PATCH to set album thumbnail
 * @param albumPath path to an album like /2001/12-31/
 */
export function setThumbnailUrl(albumPath: string): string {
    return baseApiUrl() + 'album-thumb' + albumPath;
}

/**
 * URL to send HTTP POST to generate presigned upload URLs
 * @param albumPath path to an album like /2001/12-31/
 */
export function getPresignedUploadUrlGenerationUrl(albumPath: string): string {
    return baseApiUrl() + 'presigned' + albumPath;
}

/**
 * URL to send HTTP PATCH to recrop a media thumbnail
 * @param mediaPath path to media like /2001/12-31/image.jpg or /2001/12-31/video.mp4
 */
export function recropThumbnailUrl(mediaPath: string): string {
    return baseApiUrl() + 'thumb' + mediaPath;
}

/**
 * URL to send HTTP POST to rename an album
 * @param albumPath path to an album like /2001/12-31/
 */
export function renameAlbumUrl(albumPath: string): string {
    return baseApiUrl() + 'album-rename' + albumPath;
}

/**
 * URL to send HTTP POST to rename a media item (image or video)
 * @param mediaPath path to media like /2001/12-31/image.jpg or /2001/12-31/video.mp4
 */
export function renameMediaUrl(mediaPath: string): string {
    return baseApiUrl() + 'media-rename' + mediaPath;
}

/**
 * URL to send HTTP GET to search for the specified terms
 */
export function searchUrl(q: SearchQuery, startAt: number, pageSize: number): string {
    let url = baseApiUrl() + 'search/' + encodeURIComponent(q.terms);
    const params: string[] = [];
    if (q.oldestYear) params.push('oldest=' + q.oldestYear);
    if (q.newestYear) params.push('newest=' + q.newestYear);
    if (q.oldestFirst) params.push('oldestFirst=' + q.oldestFirst);
    if (startAt) params.push('startAt=' + startAt);
    if (pageSize) params.push('pageSize=' + pageSize);
    if (params) url += '?' + params.join('&');
    return url;
}

/**
 * Relative URL to the search page within the Sveltekit app
 */
export function localSearchUrl(q: SearchQuery, returnPath: string): string {
    let url = '/search/' + encodeURIComponent(ensureDumbQuotes(q.terms));
    const params: string[] = [];
    params.push('returnPath=' + returnPath);
    if (q.oldestYear) params.push('oldest=' + q.oldestYear);
    if (q.newestYear) params.push('newest=' + q.newestYear);
    if (q.oldestFirst) params.push('oldestFirst=' + q.oldestFirst);
    if (params) url += '?' + params.join('&');
    return url;
}

/**
 * Phones insert smart quotes.
 * The search engine doesn't understand them.
 * Turn them into dumb quotes.
 */
function ensureDumbQuotes(searchTerms: string): string {
    return searchTerms.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
}

/**
 * URL to check user's authentication status
 */
export function checkAuthenticationUrl(): string {
    return baseApiUrl() + 'auth/status';
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
