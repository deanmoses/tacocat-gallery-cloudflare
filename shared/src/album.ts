import * as valibot from 'valibot';

// What `GET /api/album/<path>` returns and what the web app renders. Absent values are null rather than left out, as
// they come out of the database, so a field is either there or a bug.

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
});

const mediaChild = valibot.object({
    itemType: valibot.picklist(['image', 'video']),
    ...record,
    tags: valibot.nullable(valibot.string()),
    versionId: valibot.nullable(valibot.string()),
    width: valibot.nullable(valibot.number()),
    height: valibot.nullable(valibot.number()),
    durationSeconds: valibot.nullable(valibot.number()),
});

/** Just enough to link to the album before or after this one. */
const navInfo = valibot.object({ path: valibot.string(), title: valibot.nullable(valibot.string()) });

const album = valibot.object({
    path: valibot.string(),
    title: valibot.nullable(valibot.string()),
    description: valibot.nullable(valibot.string()),
    published: valibot.boolean(),
    // The root album is not a row, so it has no timestamp.
    updatedOn: valibot.nullable(valibot.string()),
    prev: valibot.nullable(navInfo),
    next: valibot.nullable(navInfo),
    children: valibot.array(valibot.variant('itemType', [albumChild, mediaChild])),
});

export type Album = valibot.InferOutput<typeof album>;
export type AlbumChild = valibot.InferOutput<typeof albumChild>;
export type MediaChild = valibot.InferOutput<typeof mediaChild>;
export type Child = AlbumChild | MediaChild;
export type NavInfo = valibot.InferOutput<typeof navInfo>;

/** Checks that `input`, a parsed JSON body, is an album; throws with the first field that is not. */
export function parseAlbum(input: unknown): Album {
    return valibot.parse(album, input);
}
