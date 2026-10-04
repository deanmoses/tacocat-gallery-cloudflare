// What a recovery from one of the old galleries brings over, however that gallery's database described it.
import type { Rectangle } from './aws-crops.ts';

/** One photo to bring over. */
export interface RecoveredMedia {
    /** The file's own path under the albums folder it comes from, such as `2008/01-10/galette02-recette.jpg`. */
    file: string;
    /** The gallery path it gets, such as `/2008/01-10/galette02_recette`. */
    path: string;
    name: string;
    title: string | null;
    description: string | null;
    /** The thumbnail an admin cut in the old gallery, in pixels of the image. */
    crop: Rectangle | null;
    size: { width: number; height: number };
    /** The file's size as the old gallery recorded it, where the file to upload is the one it held. */
    bytes: number | null;
    tags: string[];
    /**
     * The old gallery's own copy of the file, under `files/` in the run's directory, such as
     * `2008/02-03/pk/collin.jpg`, uploaded when Dropbox holds no original.
     */
    copy?: string;
}

/** One day album's share of the recovery. */
export interface RecoveredAlbum {
    path: string;
    /**
     * Whether the album itself is recovered, unpublished, with its words, thumbnail and order. When false the album
     * is one the gallery has, and only photos hidden inside it are added.
     */
    draft: boolean;
    summary: string | null;
    description: string | null;
    /** The gallery path of the photo the album is shown by. */
    thumbnail: string | null;
    /** The names in the order the album is shown in, or null where that is the order of the names. */
    order: string[] | null;
    media: RecoveredMedia[];
}
