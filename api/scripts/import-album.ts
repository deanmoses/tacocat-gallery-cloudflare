// Copies one day album from the AWS gallery into this one, through the Worker's own routes: each original is
// presigned and PUT to R2 as a browser upload is, so the pipeline records it and makes its derived images, and the
// album's and photos' words, crops and thumbnail go through the admin write routes. Tags are not written: the pipeline
// reads them from each file's XMP keywords, which is where the AWS gallery's came from.
//
// Usage: node api/scripts/import-album.ts /2024/12-17/ [--from prod] [--to production|local] [--user moses] [--resume]
//
// --resume finishes an import that stopped partway: it uploads only the photos the target album does not list yet and
// then writes the words and thumbnails for all of them, where a plain run uploads every photo again as a new version.
//
// The session cookie is signed with the target Worker's SESSION_SECRET, which api/.dev.vars holds for each: as
// SESSION_SECRET for local, and as SESSION_SECRET_STAGING and SESSION_SECRET_PRODUCTION the values `wrangler secret
// put` gave the deployed Workers.
import { setTimeout as sleep } from 'node:timers/promises';
import * as valibot from 'valibot';
import { adminCookie } from './admin-cookie.ts';
import { devVars } from './dev-vars.ts';

const TARGETS = {
    staging: 'https://staging-pix.deanmoses.com',
    production: 'https://pix.deanmoses.com',
    local: 'http://localhost:8787',
};
const SOURCES = {
    staging: { api: 'https://api.staging-pix.tacocat.com', images: 'https://img.staging-pix.tacocat.com' },
    prod: { api: 'https://api.pix.tacocat.com', images: 'https://img.pix.tacocat.com' },
};
const UPLOADS_AT_ONCE = 4;
const PROCESSING_TIMEOUT_MS = 5 * 60_000;
// R2 answers the odd PUT with a 503 that a second try does not see.
const PUT_ATTEMPTS = 3;
const PUT_RETRY_MS = 2000;

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

// This Worker's album, as far as the wait for the uploads reads it: an upload is done when the album lists its name
// under the version presign minted for it.
const LISTED = valibot.object({
    children: valibot.optional(valibot.array(valibot.object({ itemName: TEXT, versionId: valibot.optional(TEXT) }))),
});
const PRESIGNED = valibot.record(TEXT, valibot.object({ url: TEXT, versionId: TEXT }));
const ERRORS = valibot.object({ errors: valibot.record(TEXT, TEXT) });

const albumPath = process.argv[2] ?? '';
const source = process.argv.includes('--from') ? SOURCES.prod : SOURCES.staging;
const targetName = targetOf(argument('--to') ?? 'staging');
const site = TARGETS[targetName];
const year = yearOf(albumPath);

// The Worker records who asked for each upload, so the name has to be one of its users.
const cookie = await adminCookie(await sessionSecret(targetName), argument('--user') ?? 'moses');
const album = valibot.parse(AWS_ALBUM, await (await fetch(`${source.api}/album${albumPath}`)).json());
const media = (album.children ?? []).filter((child) => child.itemType === 'image');
const [photos, videos] = [media.filter((item) => !isVideo(item)), media.filter(isVideo)];
console.log(`${albumPath}: ${photos.length} photos to copy; ${videos.length} videos left behind`);

// The albums first, published as the source has them, so that the uploads land in them and the wait can read the day.
await ensureAlbum(`/${year}/`, { published: true });
await ensureAlbum(albumPath, {
    published: album.published ?? false,
    summary: album.summary ?? null,
    description: album.description ?? null,
});

const existing = await existingNames();
const toUpload = process.argv.includes('--resume') ? photos.filter((photo) => !existing.has(photo.itemName)) : photos;
if (toUpload.length < photos.length) {
    console.log(`resuming: ${photos.length - toUpload.length} already there, ${toUpload.length} to upload`);
}
const versions = new Map<string, string>();
await inParallel(toUpload, UPLOADS_AT_ONCE, async (photo) => {
    versions.set(photo.itemName, await upload(photo));
    console.log(`uploaded ${photo.path}`);
});
await untilProcessed(versions);

// What an admin wrote about each photo, over what its file said, and which one shows the album.
for (const photo of photos) {
    const words = { title: photo.title ?? null, description: photo.description ?? null };
    if (words.title !== null || words.description !== null) {
        await write('PATCH', `/api/media${photo.path}`, words);
    }
    if (photo.thumbnail !== undefined && photo.dimensions !== undefined) {
        await write('PATCH', `/api/thumb${photo.path}`, percentOf(photo.thumbnail, photo.dimensions));
    }
}
const thumbnail = album.thumbnail?.path;
if (thumbnail !== undefined && photos.some((photo) => photo.path === thumbnail)) {
    await write('PATCH', `/api/album-thumb${albumPath}`, { mediaPath: thumbnail });
}
console.log(`done: ${site}${albumPath.slice(0, -1)}`);

function usage(): string {
    return 'Usage: node api/scripts/import-album.ts /2024/12-17/ [--from prod] [--to production|local] [--user moses] [--resume]';
}

/** The value after `flag` on the command line, if it is there. */
function argument(flag: string): string | undefined {
    const at = process.argv.indexOf(flag);
    return at === -1 ? undefined : process.argv[at + 1];
}

function targetOf(name: string): keyof typeof TARGETS {
    if (name === 'staging' || name === 'production' || name === 'local') {
        return name;
    }
    throw new Error(usage());
}

/** The year of a day album's path, or the usage message for anything else. */
function yearOf(candidate: string): string {
    const match = /^\/(?<year>\d{4})\/\d{2}-\d{2}\/$/v.exec(candidate);
    if (match?.groups === undefined) {
        throw new Error(usage());
    }
    return match.groups['year'] ?? '';
}

/** The secret the target Worker signs sessions with. */
async function sessionSecret(target: keyof typeof TARGETS): Promise<string> {
    const name = target === 'local' ? 'SESSION_SECRET' : `SESSION_SECRET_${target.toUpperCase()}`;
    const secret = (await devVars())[name] ?? '';
    if (secret === '') {
        throw new Error(`${name} is not set in api/.dev.vars`);
    }
    return secret;
}

function isVideo(item: AwsMedia): boolean {
    return item.mediaType === 'video';
}

/** Creates the album with `fields`, or sets them on the album that is already there. */
async function ensureAlbum(path: string, fields: Record<string, unknown>): Promise<void> {
    const created = await fetch(`${site}/api/album${path}`, {
        method: 'PUT',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify(fields),
    });
    await created.body?.cancel();
    if (created.ok) {
        return;
    }
    if (created.status !== 400) {
        throw new Error(`creating ${path} failed: ${created.status}`);
    }
    await write('PATCH', `/api/album${path}`, fields);
}

/** One admin write, which the Worker answers 204 or with the reason it refused. */
async function write(method: string, path: string, body: unknown): Promise<void> {
    const response = await fetch(`${site}${path}`, {
        method,
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`${method} ${path} failed: ${response.status} ${await response.text()}`);
    }
    await response.body?.cancel();
}

/**
 * Sends the original to R2's inbox as the browser does: asks the Worker for a presigned URL, as a replacement if the
 * album already lists the name, and PUTs the file to it. Returns the version id the item will carry once the
 * Worker has processed the upload.
 */
async function upload(photo: AwsMedia): Promise<string> {
    const response = await fetch(`${source.images}${photo.path}`);
    if (!response.ok) {
        throw new Error(`downloading ${photo.path} failed: ${response.status}`);
    }
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    const body = await response.arrayBuffer();
    const galleryPath = `${albumPath}${photo.itemName}`;
    const presigned = await fetch(`${site}/api/presigned${albumPath}`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify([
            existing.has(photo.itemName) ? { path: galleryPath, replaces: galleryPath } : { path: galleryPath },
        ]),
    });
    if (!presigned.ok) {
        throw new Error(`presigning ${galleryPath} failed: ${presigned.status} ${await presigned.text()}`);
    }
    const target = valibot.parse(PRESIGNED, await presigned.json())[galleryPath];
    if (target === undefined) {
        throw new Error(`presigning ${galleryPath} answered without it`);
    }
    // Under wrangler dev the URL is a path on the Worker, which a browser resolves against the site and sends its
    // cookie to; a presigned URL is R2's and gets no cookie.
    const url = new URL(target.url, site);
    for (let attempt = 1; ; attempt++) {
        const put = await fetch(url, {
            method: 'PUT',
            headers: { 'content-type': contentType, ...(url.origin === site && { cookie }) },
            body,
        });
        if (put.ok) {
            await put.body?.cancel();
            return target.versionId;
        }
        const reason = `${put.status} ${await put.text()}`;
        if (put.status < 500 || attempt === PUT_ATTEMPTS) {
            throw new Error(`uploading ${photo.path} failed: ${reason}`);
        }
        console.log(`retrying ${photo.path} after ${reason.slice(0, 40)}`);
        await sleep(PUT_RETRY_MS);
    }
}

/** The names the target album already lists, which an upload of the same name has to say it replaces. */
async function existingNames(): Promise<Set<string>> {
    const response = await fetch(`${site}/api/album${albumPath}?consistency=primary`, { headers: { cookie } });
    if (!response.ok) {
        await response.body?.cancel();
        return new Set();
    }
    const listed = valibot.parse(LISTED, await response.json());
    return new Set((listed.children ?? []).map((child) => child.itemName));
}

/**
 * Waits until the album lists every name under the version its upload was presigned with, which is the upload
 * processed, and gives up as soon as the Worker reports an upload failed.
 */
async function untilProcessed(expected: Map<string, string>): Promise<void> {
    const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
    let missing = [...expected.keys()];
    while (Date.now() < deadline) {
        const response = await fetch(`${site}/api/album${albumPath}?consistency=primary`, { headers: { cookie } });
        if (response.ok) {
            const listed = valibot.parse(LISTED, await response.json());
            const done = new Map((listed.children ?? []).map((child) => [child.itemName, child.versionId]));
            missing = missing.filter((name) => done.get(name) !== expected.get(name));
            if (missing.length === 0) {
                return;
            }
        } else {
            await response.body?.cancel();
        }
        const failed = await uploadErrors(missing);
        if (Object.keys(failed).length > 0) {
            throw new Error(`the Worker refused: ${JSON.stringify(failed)}`);
        }
        console.log(`waiting for ${missing.length} uploads to be processed`);
        await sleep(3000);
    }
    throw new Error(`not processed in time: ${missing.join(', ')}`);
}

/** The last day's upload errors for `names` in the album, by path. */
async function uploadErrors(names: string[]): Promise<Record<string, string>> {
    const response = await fetch(`${site}/api/errors`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ paths: names.map((name) => `${albumPath}${name}`) }),
    });
    if (!response.ok) {
        await response.body?.cancel();
        return {};
    }
    return valibot.parse(ERRORS, await response.json()).errors;
}

/** A crop in pixels of an image as the recut route takes it, in percent of the image. */
function percentOf(
    crop: valibot.InferOutput<typeof RECTANGLE>,
    size: { width: number; height: number },
): Record<string, number> {
    return {
        x: (crop.x / size.width) * 100,
        y: (crop.y / size.height) * 100,
        width: (crop.width / size.width) * 100,
        height: (crop.height / size.height) * 100,
    };
}

async function inParallel<T>(items: T[], atOnce: number, work: (item: T) => Promise<void>): Promise<void> {
    const queue = [...items];
    const lanes = Array.from({ length: atOnce }, async () => {
        for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
            await work(next);
        }
    });
    await Promise.all(lanes);
}
