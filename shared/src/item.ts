import * as valibot from 'valibot';
import { rectangleSchema } from './album';
import { mediaTypeSchema } from './item-type';
import { albumKey, albumPath, isAlbumPath, isVideoName, mediaKey, mediaPath } from './paths';

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
            'an album is a year in / or a day in a year, and media a file in a day album, a video by its extension',
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

const searchFields = {
    path: valibot.string(),
    itemName: valibot.string(),
    title: valibot.nullable(valibot.string()),
    // Part of the description, with the words that matched in [brackets]; null when there is no description.
    snippet: valibot.nullable(valibot.string()),
};

const searchResult = valibot.variant('itemType', [
    valibot.object({ itemType: valibot.literal('album'), ...searchFields }),
    valibot.object({ itemType: valibot.literal('media'), mediaType: mediaTypeSchema, ...searchFields }),
]);

/** What `GET /api/search?q=` returns: the best matches this viewer may see, best first. */
const searchResponse = valibot.object({
    q: valibot.string(),
    count: valibot.number(),
    results: valibot.array(searchResult),
});

export type SearchResult = valibot.InferOutput<typeof searchResult>;
export type SearchResponse = valibot.InferOutput<typeof searchResponse>;

/** Checks that `input`, a parsed JSON body, is a search response; throws with the first field that is not. */
export function parseSearch(input: unknown): SearchResponse {
    return valibot.parse(searchResponse, input);
}
