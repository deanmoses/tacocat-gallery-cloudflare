import * as valibot from 'valibot';
import { rectangleSchema } from './album';
import { type ItemType, itemTypeSchema } from './item-type';
import { type ItemKey, albumKey, albumPath, isAlbumPath, isVideoName, mediaKey, mediaPath } from './paths';

function clearable<T extends valibot.GenericSchema>(
    schema: T,
): valibot.OptionalSchema<valibot.NullableSchema<T, undefined>, undefined> {
    return valibot.optional(valibot.nullable(schema));
}

/**
 * The body of `PUT /api/item`, which saves every field of the item at that key: a field left out is cleared. Strict,
 * so that a misspelled field is refused rather than clearing the one it meant.
 */
export const itemWriteSchema = valibot.pipe(
    valibot.strictObject({
        parentPath: valibot.string(),
        itemName: valibot.string(),
        itemType: itemTypeSchema,
        title: clearable(valibot.string()),
        description: clearable(valibot.string()),
        tags: clearable(valibot.string()),
        versionId: clearable(valibot.string()),
        published: valibot.optional(valibot.boolean()),
        width: clearable(valibot.pipe(valibot.number(), valibot.integer())),
        height: clearable(valibot.pipe(valibot.number(), valibot.integer())),
        durationSeconds: clearable(valibot.number()),
        thumbnailCrop: clearable(rectangleSchema),
    }),
    valibot.forward(
        valibot.partialCheck(
            [['parentPath'], ['itemName'], ['itemType']],
            isGalleryKey,
            'an album is a year in / or a day in a year, and media a file in a day album, a video by its extension',
        ),
        ['itemName'],
    ),
);

/** Whether an item of `itemType` can live at this key, so the album pages can show it. */
function isGalleryKey({ parentPath, itemName, itemType }: ItemKey & { itemType: ItemType }): boolean {
    if (itemType === 'album') {
        const path = albumPath(parentPath, itemName);
        const key = albumKey(path);
        return isAlbumPath(path) && key?.parentPath === parentPath && key.itemName === itemName;
    }
    const key = mediaKey(mediaPath(parentPath, itemName));
    return (
        key?.parentPath === parentPath && key.itemName === itemName && isVideoName(itemName) === (itemType === 'video')
    );
}

export type ItemWrite = valibot.InferOutput<typeof itemWriteSchema>;

const searchResult = valibot.object({
    itemType: itemTypeSchema,
    path: valibot.string(),
    itemName: valibot.string(),
    title: valibot.nullable(valibot.string()),
    // Part of the description, with the words that matched in [brackets]; null when there is no description.
    snippet: valibot.nullable(valibot.string()),
});

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
