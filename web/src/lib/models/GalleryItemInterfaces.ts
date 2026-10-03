//
// What components read: plain objects built from the server's records, with
// every display default applied, so that no optional field reaches a template
//

import type { ItemType, MediaType } from '@tacocat-gallery/shared';
import type { AlbumGalleryItem, Rectangle } from './impl/server';

export type { MediaType };

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
    /**
     * The server's record, unaltered: what goes to the disk cache, and what an edit copies. The other fields were
     * computed from it once, so a change made to it in place would not reach them.
     */
    readonly json: Readonly<AlbumGalleryItem>;
    readonly parentHref: string;
    readonly parentTitle: string;
    readonly media: Media[];
    readonly albums: Album[];
}

/** An image or a video, told apart by `mediaType` */
export type Media = Image | Video;

/** What images and videos share */
export interface BaseMedia extends Thumbable {
    readonly title: string;
    readonly versionId: string;
    readonly thumbnail: Rectangle | undefined;
    /** Sized image for photos, poster for videos */
    readonly detailUrl: string;
    readonly detailWidth: number;
    readonly detailHeight: number;
}

export interface Image extends BaseMedia {
    readonly mediaType: 'image';
    readonly originalUrl: string;
    readonly originalWidth: number;
    readonly originalHeight: number;
}

export interface Video extends BaseMedia {
    readonly mediaType: 'video';
    /** Duration in seconds */
    readonly duration: number;
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
}
