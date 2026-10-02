// Copies one day album from the AWS gallery into this one, through the Worker's own routes: each original is
// presigned and PUT to R2 as a browser upload is, so the pipeline records it and makes its derived images, and the
// album's and photos' words, crops and thumbnail go through the admin write routes. Tags are not written: the pipeline
// reads them from each file's XMP keywords, which is where the AWS gallery's came from. Each photo lands under the
// name this gallery gives it, its extension dropped and the rest sanitized, with `_n` where two come out the same,
// and a link in a caption to an AWS media path is pointed at the new one: by this album's own renames, or for
// another album's item by the sanitizer alone, which is right unless that item collided with another in its day.
//
// Usage: node api/scripts/import-album.ts /2024/12-17/ [--from prod] [--to production|local] [--user moses] [--resume]
//
// --resume finishes an import that stopped partway: it uploads only the photos the target album does not list yet and
// then writes the words and thumbnails for all of them, where a plain run uploads every photo again as a new version.
import * as valibot from 'valibot';
import { extensionOf, mediaPath, parsePath } from '@tacocat-gallery/shared';
import { renamedMedia, rewriteLinks, sanitizedPath } from './aws-names.ts';
import {
    type SITES,
    createAlbum,
    galleryAt,
    inParallel,
    listedVersions,
    percentOf,
    untilProcessed,
    upload,
    write,
} from './gallery-upload.ts';

const SOURCES = {
    staging: { api: 'https://api.staging-pix.tacocat.com', images: 'https://img.staging-pix.tacocat.com' },
    prod: { api: 'https://api.pix.tacocat.com', images: 'https://img.pix.tacocat.com' },
};
const UPLOADS_AT_ONCE = 4;

// The AWS API's album, as far as this script reads it. 'image' there means any media item; a video says so in
// mediaType. A photo's thumbnail is its crop, in pixels of the image.
const TEXT = valibot.string();
const RECTANGLE = valibot.object({
    x: valibot.number(),
    y: valibot.number(),
    width: valibot.number(),
    height: valibot.number(),
});
const AWS_MEDIA = valibot.looseObject({
    itemType: TEXT,
    itemName: TEXT,
    path: TEXT,
    mediaType: valibot.optional(TEXT),
    title: valibot.optional(TEXT),
    description: valibot.optional(TEXT),
    dimensions: valibot.optional(valibot.object({ width: valibot.number(), height: valibot.number() })),
    thumbnail: valibot.optional(RECTANGLE),
});
const AWS_ALBUM = valibot.looseObject({
    path: TEXT,
    published: valibot.optional(valibot.boolean()),
    summary: valibot.optional(TEXT),
    description: valibot.optional(TEXT),
    thumbnail: valibot.optional(valibot.object({ path: TEXT })),
    children: valibot.optional(valibot.array(AWS_MEDIA)),
});
type AwsMedia = valibot.InferOutput<typeof AWS_MEDIA>;

const albumPath = process.argv[2] ?? '';
const source = process.argv.includes('--from') ? SOURCES.prod : SOURCES.staging;
const targetName = targetOf(argument('--to') ?? 'staging');
const year = yearOf(albumPath);

// The Worker records who asked for each upload, so the name has to be one of its users.
const gallery = await galleryAt(targetName, argument('--user') ?? 'moses');
const album = valibot.parse(AWS_ALBUM, await (await fetch(`${source.api}/album${albumPath}`)).json());
const media = (album.children ?? []).filter((child) => child.itemType === 'image');
const [photos, videos] = [media.filter((item) => !isVideo(item)), media.filter(isVideo)];
console.log(`${albumPath}: ${photos.length} photos to copy; ${videos.length} videos left behind`);

// Each item's name here, by its AWS name, decided over every media item of the day, videos included, so the names
// the videos will take when they are copied are already spoken for.
const names = new Map(renamedMedia(media).map((renamed) => [renamed.from, renamed.to]));
for (const renamed of renamedMedia(media).filter((item) => item.from !== item.to)) {
    console.log(`${renamed.collided ? 'collision: ' : ''}${renamed.from} → ${renamed.to}`);
}

// The albums first, published as the source has them, so that the uploads land in them and the wait can read the day.
await ensureAlbum(`/${year}/`, { published: true });
await ensureAlbum(albumPath, {
    published: album.published ?? false,
    summary: album.summary === undefined ? null : withLinksRewritten(album.summary, albumPath),
    description: album.description === undefined ? null : withLinksRewritten(album.description, albumPath),
});

const existing = new Set((await listedVersions(gallery, albumPath))?.keys());
const toUpload = process.argv.includes('--resume') ? photos.filter((photo) => !existing.has(nameOf(photo))) : photos;
if (toUpload.length < photos.length) {
    console.log(`resuming: ${photos.length - toUpload.length} already there, ${toUpload.length} to upload`);
}
const versions = new Map<string, string>();
await inParallel(toUpload, UPLOADS_AT_ONCE, async (photo) => {
    versions.set(nameOf(photo), await uploaded(photo));
    console.log(`uploaded ${photo.path} as ${pathOf(photo)}`);
});
await untilProcessed(gallery, albumPath, versions);

// What an admin wrote about each photo, over what its file said, and which one shows the album.
for (const photo of photos) {
    const words = {
        title: photo.title ?? null,
        description: photo.description === undefined ? null : withLinksRewritten(photo.description, pathOf(photo)),
    };
    if (words.title !== null || words.description !== null) {
        await write(gallery, 'PATCH', `/api/media${pathOf(photo)}`, words);
    }
    if (photo.thumbnail !== undefined && photo.dimensions !== undefined) {
        await write(gallery, 'PATCH', `/api/thumb${pathOf(photo)}`, percentOf(photo.thumbnail, photo.dimensions));
    }
}
const thumbnail = photos.find((photo) => photo.path === album.thumbnail?.path);
if (thumbnail !== undefined) {
    await write(gallery, 'PATCH', `/api/album-thumb${albumPath}`, { mediaPath: pathOf(thumbnail) });
}
console.log(`done: ${gallery.site}${albumPath.slice(0, -1)}`);

/** The name a media item of this album gets here. */
function nameOf(item: AwsMedia): string {
    return names.get(item.itemName) ?? '';
}

function pathOf(item: AwsMedia): string {
    return mediaPath(albumPath, nameOf(item));
}

/**
 * A caption with its links to AWS media paths pointed at the new ones, each link said, and one that resolves to
 * nothing left as it is for a person.
 */
function withLinksRewritten(caption: string, at: string): string {
    const { html, links } = rewriteLinks(caption, (awsPath) => {
        const cut = awsPath.lastIndexOf('/');
        const [linkedAlbum, linkedName] = [awsPath.slice(0, cut + 1), awsPath.slice(cut + 1)];
        if (linkedAlbum === albumPath) {
            const name = names.get(linkedName);
            return name === undefined ? null : mediaPath(albumPath, name);
        }
        return sanitizedPath(awsPath);
    });
    for (const link of links) {
        console.log(`${at}: link ${link.from} → ${link.to ?? 'unresolved, left as it was'}`);
    }
    return html;
}

function usage(): string {
    return 'Usage: node api/scripts/import-album.ts /2024/12-17/ [--from prod] [--to production|local] [--user moses] [--resume]';
}

/** The value after `flag` on the command line, if it is there. */
function argument(flag: string): string | undefined {
    const at = process.argv.indexOf(flag);
    return at === -1 ? undefined : process.argv[at + 1];
}

function targetOf(name: string): keyof typeof SITES {
    if (name === 'staging' || name === 'production' || name === 'local') {
        return name;
    }
    throw new Error(usage());
}

/** The year of a day album's path, `/2001/06-15/`, or the usage message for anything else. */
function yearOf(candidate: string): string {
    const parsed = parsePath(candidate);
    if (parsed?.kind !== 'day') {
        throw new Error(usage());
    }
    return String(parsed.date.getFullYear());
}

function isVideo(item: AwsMedia): boolean {
    return item.mediaType === 'video';
}

/** Creates the album with `fields`, or sets them on the album that is already there. */
async function ensureAlbum(path: string, fields: Record<string, unknown>): Promise<void> {
    if (!(await createAlbum(gallery, path, fields))) {
        await write(gallery, 'PATCH', `/api/album${path}`, fields);
    }
}

/**
 * Downloads the original by its AWS path and uploads it under the item's new path, as a replacement if the album
 * already lists the name. Returns the version id the item will carry once the Worker has processed the upload.
 */
async function uploaded(photo: AwsMedia): Promise<string> {
    const response = await fetch(`${source.images}${photo.path}`);
    if (!response.ok) {
        throw new Error(`downloading ${photo.path} failed: ${String(response.status)}`);
    }
    const file = { body: await response.arrayBuffer(), extension: extensionOf(photo.path) };
    return upload(gallery, albumPath, pathOf(photo), file, existing.has(nameOf(photo)));
}
