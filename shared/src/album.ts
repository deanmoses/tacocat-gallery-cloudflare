import * as valibot from 'valibot';
import { mediaTypeSchema } from './item-type';

// What `GET /api/album/<path>` returns and what the web app renders. Absent values are null rather than left out, as
// they come out of the database, so a field is either there or a bug.

/** A rectangle in an image's EXIF-oriented pixels. */
export const rectangleSchema = valibot.object({
    x: valibot.number(),
    y: valibot.number(),
    width: valibot.number(),
    height: valibot.number(),
});

/** The media item an album is shown by, with what a thumbnail URL needs: which version, and the rectangle to cut. */
const thumbnail = valibot.object({
    path: valibot.string(),
    versionId: valibot.nullable(valibot.string()),
    crop: valibot.nullable(rectangleSchema),
});

const record = {
    path: valibot.string(),
    itemName: valibot.string(),
    title: valibot.nullable(valibot.string()),
    description: valibot.nullable(valibot.string()),
    updatedOn: valibot.string(),
};

const albumChild = valibot.object({
    itemType: valibot.literal('album'),
    ...record,
    published: valibot.boolean(),
    thumbnail: valibot.nullable(thumbnail),
});

const mediaChild = valibot.object({
    itemType: mediaTypeSchema,
    ...record,
    tags: valibot.nullable(valibot.string()),
    versionId: valibot.nullable(valibot.string()),
    width: valibot.nullable(valibot.number()),
    height: valibot.nullable(valibot.number()),
    durationSeconds: valibot.nullable(valibot.number()),
    thumbnailCrop: valibot.nullable(rectangleSchema),
});

const album = valibot.object({
    path: valibot.string(),
    title: valibot.nullable(valibot.string()),
    description: valibot.nullable(valibot.string()),
    published: valibot.boolean(),
    // The root album is not a row, so it has no timestamp and no thumbnail.
    updatedOn: valibot.nullable(valibot.string()),
    thumbnail: valibot.nullable(thumbnail),
    children: valibot.array(valibot.variant('itemType', [albumChild, mediaChild])),
});

/** The body of `POST /api/album/<path>/thumbnail`: the media item, in that album or any other, to show it by. */
export const setThumbnailSchema = valibot.object({ path: valibot.string() });

export type Rectangle = valibot.InferOutput<typeof rectangleSchema>;
export type Thumbnail = valibot.InferOutput<typeof thumbnail>;
export type Album = valibot.InferOutput<typeof album>;
export type AlbumChild = valibot.InferOutput<typeof albumChild>;
export type MediaChild = valibot.InferOutput<typeof mediaChild>;
export type Child = AlbumChild | MediaChild;

/** Checks that `input`, a parsed JSON body, is an album; throws with the first field that is not. */
export function parseAlbum(input: unknown): Album {
    return valibot.parse(album, input);
}
