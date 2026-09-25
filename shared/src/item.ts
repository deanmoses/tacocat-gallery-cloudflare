import * as valibot from 'valibot';
import { galleryRecordSchema, rectangleSchema } from './album';
import { mediaTypeSchema } from './item-type';
import { albumKey, albumPath, isAlbumPath, isStoredMediaName, isVideoName, mediaKey, mediaPath } from './paths';

function clearable<T extends valibot.GenericSchema>(
    schema: T,
): valibot.OptionalSchema<valibot.NullableSchema<T, undefined>, undefined> {
    return valibot.optional(valibot.nullable(schema));
}

const integer = valibot.pipe(valibot.number(), valibot.integer());
const positive = valibot.pipe(integer, valibot.minValue(1));

/** Text with something in it once trimmed: a caption that would be blank is left out or cleared instead. */
const caption = valibot.pipe(
    valibot.string(),
    valibot.check((text) => text.trim() !== '', 'is blank; leave it out or clear it with null'),
);

/** At least one tag, none blank. */
const tags = valibot.pipe(valibot.array(caption), valibot.minLength(1, 'has no tags; clear them with null'));

const writeFields = {
    parentPath: valibot.string(),
    itemName: valibot.string(),
    description: clearable(caption),
};

// Strict, so that a misspelled field is refused rather than clearing the one it meant.
const itemWrite = valibot.variant('itemType', [
    valibot.strictObject({
        itemType: valibot.literal('album'),
        ...writeFields,
        summary: clearable(caption),
        /** Guests see published albums; media shows whenever its album does. */
        published: valibot.optional(valibot.boolean()),
    }),
    valibot.strictObject({
        itemType: valibot.literal('media'),
        mediaType: mediaTypeSchema,
        ...writeFields,
        title: clearable(caption),
        tags: clearable(tags),
        // Every media item has a file, and the album pages need its size to lay it out.
        versionId: valibot.string(),
        width: positive,
        height: positive,
        durationSeconds: clearable(valibot.pipe(valibot.number(), valibot.minValue(0))),
        thumbnailCrop: clearable(rectangleSchema),
    }),
]);

/** The body of `PUT /api/item`, which saves every field of the item at that key: a field left out is cleared. */
export const itemWriteSchema = valibot.pipe(
    itemWrite,
    valibot.forward(
        valibot.check(
            isGalleryKey,
            'an album is a year in / or a day in a year, and media a file in a day album with an extension the gallery stores, jpg not jpeg, a video by its extension',
        ),
        ['itemName'],
    ),
    valibot.forward(
        valibot.check(cropFits, 'a thumbnail crop starts at or after 0 and fits inside the width and height'),
        ['thumbnailCrop'],
    ),
);

export type ItemWrite = valibot.InferOutput<typeof itemWrite>;

/** Whether an item of this type can live at this key, so the album pages can show it. */
function isGalleryKey(item: ItemWrite): boolean {
    const { parentPath, itemName } = item;
    if (item.itemType === 'album') {
        const path = albumPath(parentPath, itemName);
        const key = albumKey(path);
        return isAlbumPath(path) && key?.parentPath === parentPath && key.itemName === itemName;
    }
    const key = mediaKey(mediaPath(parentPath, itemName));
    return (
        key?.parentPath === parentPath &&
        key.itemName === itemName &&
        isStoredMediaName(itemName) &&
        isVideoName(itemName) === (item.mediaType === 'video')
    );
}

/** Whether a media item's crop, when it has one, is a rectangle of its own pixels. */
function cropFits(item: ItemWrite): boolean {
    if (item.itemType === 'album' || item.thumbnailCrop === undefined || item.thumbnailCrop === null) {
        return true;
    }
    const { x, y, width, height } = item.thumbnailCrop;
    return x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= item.width && y + height <= item.height;
}

/**
 * The body of `PUT` and `PATCH /api/album/<path>`: what an admin writes about an album, every field optional. A
 * caption that is blank clears the field, since the editor sends what is left when the text is deleted.
 */
export const albumWriteSchema = valibot.strictObject({
    description: valibot.optional(valibot.nullable(valibot.string())),
    summary: valibot.optional(valibot.nullable(valibot.string())),
    published: valibot.optional(valibot.boolean()),
});

/** The body of `PATCH /api/media/<path>`: what an admin writes about a photo or video, every field optional. */
export const mediaWriteSchema = valibot.strictObject({
    title: valibot.optional(valibot.nullable(valibot.string())),
    description: valibot.optional(valibot.nullable(valibot.string())),
});

const percent = valibot.pipe(valibot.number(), valibot.minValue(0), valibot.maxValue(100));

/** The body of `PATCH /api/thumb/<path>`: the rectangle to cut the thumbnail from, in percent of the image. */
export const cropPercentSchema = valibot.pipe(
    valibot.strictObject({
        x: percent,
        y: percent,
        width: valibot.pipe(percent, valibot.minValue(Number.EPSILON, 'has no width')),
        height: valibot.pipe(percent, valibot.minValue(Number.EPSILON, 'has no height')),
    }),
    valibot.check((crop) => crop.x + crop.width <= 100 && crop.y + crop.height <= 100, 'runs off the image'),
);

export type MediaWrite = valibot.InferOutput<typeof mediaWriteSchema>;
export type CropPercent = valibot.InferOutput<typeof cropPercentSchema>;

/** The body of `POST /api/album-rename/<path>` and `POST /api/media-rename/<path>`. */
export const renameSchema = valibot.strictObject({ newName: valibot.string() });

/** The body of `PATCH /api/album-thumb/<path>`: the media item, in the album or an album inside it, to show it by. */
export const albumThumbnailSchema = valibot.strictObject({ mediaPath: valibot.string() });

/**
 * The body of `POST /api/presigned/<albumPath>`: the media path each upload will have, and for a replacement, the path
 * of the item it replaces, whose base name `path` keeps with the new file's extension.
 */
export const presignRequestSchema = valibot.pipe(
    valibot.array(valibot.strictObject({ path: valibot.string(), replaces: valibot.optional(valibot.string()) })),
    valibot.minLength(1, 'No media to upload'),
);

export type PresignRequest = valibot.InferOutput<typeof presignRequestSchema>;

/** Where to PUT one upload, and the version id the item will carry once the upload is processed. */
const presignedUpload = valibot.object({ url: valibot.string(), versionId: valibot.string() });

/** What `POST /api/presigned` returns: one presigned upload per path asked for, keyed by that path. */
const presignResponse = valibot.record(valibot.string(), presignedUpload);

export type PresignedUpload = valibot.InferOutput<typeof presignedUpload>;
export type PresignResponse = valibot.InferOutput<typeof presignResponse>;

/** Checks that `input`, a parsed JSON body, is a presign response; throws with the first field that is not. */
export function parsePresigned(input: unknown): PresignResponse {
    return valibot.parse(presignResponse, input);
}

export type AlbumWrite = valibot.InferOutput<typeof albumWriteSchema>;

/** What `GET /api/search/<terms>` returns: the matches this viewer may see, as full records, newest first. */
const searchResponse = valibot.object({
    /** Every match, not only this page. */
    total: valibot.number(),
    items: valibot.array(galleryRecordSchema),
});

export type SearchResponse = valibot.InferOutput<typeof searchResponse>;

/** Checks that `input`, a parsed JSON body, is a search response; throws with the first field that is not. */
export function parseSearch(input: unknown): SearchResponse {
    return valibot.parse(searchResponse, input);
}
