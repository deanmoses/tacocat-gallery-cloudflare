//
// The interfaces used by the Sveltekit UI
//

import type { ItemType, MediaType } from '@tacocat-gallery/shared';
import type { AlbumGalleryItem, Rectangle } from './impl/server';

export type { ItemType, MediaType };

/**
 * Info needed to construct a thumbnail URL
 */
export interface ThumbnailUrlInfo {
    readonly imagePath: string;
    readonly versionId: string;
    readonly crop?: Rectangle | undefined;
}

export interface Album extends Thumbable {
    readonly published: boolean;
    readonly summary: string;
    readonly thumbnailPath: string | undefined;
    /** Whether an admin has put the media in an order of their own, rather than by name */
    readonly reordered: boolean;
    readonly json: AlbumGalleryItem; // so that I can save the JSON to disk
    readonly parentHref: string;
    readonly parentTitle: string;
    readonly media: Media[];
    readonly albums: Thumbable[];
    getMedia: (mediaPath: string) => Media | undefined;
}

/** Base interface for all media items (images and videos) */
export interface Media extends Nextable {
    readonly mediaType: MediaType;
    readonly title: string;
    readonly versionId: string;
    readonly thumbnail: Rectangle | undefined;
    /** Sized image for photos, poster for videos */
    readonly detailUrl: string;
    readonly detailWidth: number;
    readonly detailHeight: number;
}

export interface Image extends Media {
    readonly mediaType: 'image';
    readonly originalUrl: string;
    readonly originalWidth: number;
    readonly originalHeight: number;
}

export interface Video extends Media {
    readonly mediaType: 'video';
    /** Duration in seconds */
    readonly duration: number;
}

interface Nextable extends Thumbable {
    readonly prevHref: string | undefined;
    readonly nextHref: string | undefined;
    readonly prevTitle: string | undefined;
    readonly nextTitle: string | undefined;
}

export interface Thumbable {
    readonly path: string;
    readonly itemType: ItemType;
    readonly mediaType?: MediaType;
    readonly title: string;
    readonly description: string;
    readonly summary: string;
    readonly thumbnailUrlInfo: ThumbnailUrlInfo | undefined;
    readonly href: string;
    readonly published: boolean;
}
