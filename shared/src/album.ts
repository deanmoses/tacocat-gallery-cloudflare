import * as valibot from 'valibot';

// What `GET /api/album/<path>` returns: the records of the AWS API the web app was written against, so it parses
// them unchanged. A value the record has none of is left out rather than sent as null, as the AWS API left it.

/** A rectangle in an image's EXIF-oriented pixels. */
export const rectangleSchema = valibot.object({
    x: valibot.number(),
    y: valibot.number(),
    width: valibot.number(),
    height: valibot.number(),
});

export const sizeSchema = valibot.object({
    width: valibot.number(),
    height: valibot.number(),
});

const galleryRecord = {
    path: valibot.string(),
    parentPath: valibot.string(),
    itemName: valibot.string(),
    description: valibot.optional(valibot.string()),
};

/** The media item an album is shown by, with what its thumbnail URL needs: which version, and the rectangle to cut. */
const albumThumbnail = valibot.object({
    path: valibot.string(),
    versionId: valibot.string(),
    crop: valibot.optional(rectangleSchema),
});

const albumRecord = valibot.object({
    itemType: valibot.literal('album'),
    ...galleryRecord,
    // The root album is not a row, so it has no timestamp.
    updatedOn: valibot.optional(valibot.string()),
    published: valibot.optional(valibot.boolean()),
    thumbnail: valibot.optional(albumThumbnail),
    summary: valibot.optional(valibot.string()),
});

const mediaRecord = {
    itemType: valibot.literal('media'),
    ...galleryRecord,
    updatedOn: valibot.string(),
    versionId: valibot.string(),
    dimensions: sizeSchema,
    thumbnail: valibot.optional(rectangleSchema),
    title: valibot.optional(valibot.string()),
    tags: valibot.optional(valibot.array(valibot.string())),
};

const imageRecord = valibot.object({ ...mediaRecord, mediaType: valibot.literal('image') });

const videoRecord = valibot.object({
    ...mediaRecord,
    mediaType: valibot.literal('video'),
    /** In seconds. */
    duration: valibot.number(),
});

const mediaRecordSchema = valibot.variant('mediaType', [imageRecord, videoRecord]);

/** Any item as the API sends it: an album, an image or a video. */
export const galleryRecordSchema = valibot.variant('itemType', [albumRecord, mediaRecordSchema]);

/** An album with its children: its media, or its albums. */
const albumGalleryItem = valibot.object({
    ...albumRecord.entries,
    children: valibot.optional(valibot.array(galleryRecordSchema)),
});

/** The body of `POST /api/album/<path>/thumbnail`: the media item, in that album or any other, to show it by. */
export const setThumbnailSchema = valibot.object({ path: valibot.string() });

export type Rectangle = valibot.InferOutput<typeof rectangleSchema>;
export type Size = valibot.InferOutput<typeof sizeSchema>;
export type AlbumThumbnailRecord = valibot.InferOutput<typeof albumThumbnail>;
export type AlbumRecord = valibot.InferOutput<typeof albumRecord>;
export type ImageRecord = valibot.InferOutput<typeof imageRecord>;
export type VideoRecord = valibot.InferOutput<typeof videoRecord>;
export type MediaRecord = valibot.InferOutput<typeof mediaRecordSchema>;
export type GalleryRecord = valibot.InferOutput<typeof galleryRecordSchema>;
export type AlbumGalleryItem = valibot.InferOutput<typeof albumGalleryItem>;

/** Checks that `input`, a parsed JSON body, is an album; throws with the first field that is not. */
export function parseAlbum(input: unknown): AlbumGalleryItem {
    return valibot.parse(albumGalleryItem, input);
}
