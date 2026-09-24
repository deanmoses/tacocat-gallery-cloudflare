// Copies one day album from the AWS gallery into this one. The originals go through the upload pipeline, sent to R2
// as a browser's presigned PUT would send them, so the Worker records each one and makes its derived images; the
// album's and its media's words then go straight into D1, since the Worker has no endpoint for them yet. Runs against
// the deployed Worker, with the credentials in api/.dev.vars.
//
// Usage: node api/scripts/import-album.ts /2024/12-17/ [--from prod] [--to production]
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import * as valibot from 'valibot';
import { presign } from '../src/s3.ts';

const API_DIR = fileURLToPath(new URL('..', import.meta.url));
// Where the album goes. Staging is wrangler.jsonc's top-level environment, so Wrangler reaches it without --env.
const TARGETS = {
    staging: { site: 'https://staging-pix.deanmoses.com', bucket: 'tacocat-staging-media', wranglerEnv: [] },
    production: {
        site: 'https://pix.deanmoses.com',
        bucket: 'tacocat-proto-media',
        wranglerEnv: ['--env', 'production'],
    },
};
const SOURCES = {
    staging: { api: 'https://api.staging-pix.tacocat.com', images: 'https://img.staging-pix.tacocat.com' },
    prod: { api: 'https://api.pix.tacocat.com', images: 'https://img.pix.tacocat.com' },
};
const UPLOADS_AT_ONCE = 4;
const PROCESSING_TIMEOUT_MS = 5 * 60_000;

// The AWS API's album, as far as this script reads it. 'image' there means any media item; a video says so in
// mediaType.
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
    tags: valibot.optional(valibot.array(TEXT)),
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

// This Worker's album, as far as the wait for the uploads reads it.
const LISTED = valibot.object({
    children: valibot.optional(valibot.array(valibot.object({ itemName: TEXT, versionId: valibot.optional(TEXT) }))),
});

const albumPath = process.argv[2] ?? '';
const source = process.argv.includes('--from') ? SOURCES.prod : SOURCES.staging;
const target = process.argv.includes('--to') ? TARGETS.production : TARGETS.staging;
const { year, day } = dayAlbum(albumPath);

const secrets = await devVars();
const album = valibot.parse(AWS_ALBUM, await (await fetch(`${source.api}/album${albumPath}`)).json());
const media = (album.children ?? []).filter((child) => child.itemType === 'image');
const [photos, videos] = [media.filter((item) => !isVideo(item)), media.filter(isVideo)];
console.log(`${albumPath}: ${photos.length} photos to copy; ${videos.length} videos left behind`);

// The albums first, published as the source has them, so that the uploads land in them and the wait can read the day.
await sql([
    upsertAlbum('/', year, { published: true }),
    upsertAlbum(`/${year}/`, day, {
        published: album.published ?? false,
        summary: album.summary,
        description: album.description,
    }),
]);

await inParallel(photos, UPLOADS_AT_ONCE, async (photo) => {
    await upload(photo);
    console.log(`uploaded ${photo.path}`);
});
await untilProcessed(photos.map((photo) => photo.itemName));

// What an admin wrote about each photo, over what its file said, and which one shows the album.
const statements = photos.map(
    (photo) =>
        `UPDATE item SET title = ${text(photo.title)}, description = ${text(photo.description)}, tags = ${text(
            photo.tags?.join(','),
        )}, thumbnail_crop = ${text(photo.thumbnail === undefined ? undefined : JSON.stringify(photo.thumbnail))} WHERE parent_path = ${text(
            albumPath,
        )} AND item_name = ${text(photo.itemName)};`,
);
const thumbnail = album.thumbnail?.path;
if (thumbnail !== undefined && photos.some((photo) => photo.path === thumbnail)) {
    const name = thumbnail.slice(thumbnail.lastIndexOf('/') + 1);
    statements.push(
        `UPDATE item SET thumbnail_id = (SELECT id FROM item WHERE parent_path = ${text(albumPath)} AND item_name = ${text(
            name,
        )}) WHERE parent_path = ${text(`/${year}/`)} AND item_name = ${text(day)};`,
    );
}
await sql(statements);
console.log(`done: ${target.site}${albumPath.slice(0, -1)}`);

/** The year and day of a day album's path, or the usage message for anything else. */
function dayAlbum(candidate: string): { year: string; day: string } {
    const match = /^\/(?<year>\d{4})\/(?<day>\d{2}-\d{2})\/$/v.exec(candidate);
    if (match?.groups === undefined) {
        throw new Error('Usage: node api/scripts/import-album.ts /2024/12-17/ [--from prod] [--to production]');
    }
    return { year: match.groups['year'] ?? '', day: match.groups['day'] ?? '' };
}

function isVideo(item: AwsMedia): boolean {
    return item.mediaType === 'video';
}

/** The Worker's secrets as api/.dev.vars holds them, read here and never printed. */
async function devVars(): Promise<Record<string, string>> {
    const lines = (await readFile(path.join(API_DIR, '.dev.vars'), 'utf8')).split('\n');
    return Object.fromEntries(
        lines
            .filter((line) => line.includes('='))
            .map((line) => {
                const at = line.indexOf('=');
                return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
            }),
    );
}

/** Sends the original to R2's inbox as the browser does, which is what starts the Worker's processing of it. */
async function upload(photo: AwsMedia): Promise<void> {
    const response = await fetch(`${source.images}${photo.path}`);
    if (!response.ok) {
        throw new Error(`downloading ${photo.path} failed: ${response.status}`);
    }
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    const body = await response.arrayBuffer();
    const url = await presign(
        {
            R2_ACCESS_KEY_ID: secrets['R2_ACCESS_KEY_ID'] ?? '',
            R2_SECRET_ACCESS_KEY: secrets['R2_SECRET_ACCESS_KEY'] ?? '',
            MEDIA_BUCKET: target.bucket,
        },
        { method: 'PUT', key: `inbox${photo.path}`, contentType },
    );
    const put = await fetch(url, { method: 'PUT', headers: { 'content-type': contentType }, body });
    if (!put.ok) {
        throw new Error(`uploading ${photo.path} failed: ${put.status} ${await put.text()}`);
    }
}

/** Waits until the Worker lists every name in the album with a version, which is the upload processed. */
async function untilProcessed(names: string[]): Promise<void> {
    const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
    let missing = names;
    while (Date.now() < deadline) {
        const response = await fetch(`${target.site}/api/album${albumPath}?consistency=primary`);
        if (response.ok) {
            const listed = valibot.parse(LISTED, await response.json());
            const done = new Set(
                (listed.children ?? []).filter((child) => child.versionId !== undefined).map((child) => child.itemName),
            );
            missing = names.filter((name) => !done.has(name));
            if (missing.length === 0) {
                return;
            }
        } else {
            await response.body?.cancel();
        }
        console.log(`waiting for ${missing.length} uploads to be processed`);
        await sleep(3000);
    }
    throw new Error(`not processed in time: ${missing.join(', ')}`);
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

function upsertAlbum(
    parentPath: string,
    itemName: string,
    fields: { published: boolean; summary?: string | undefined; description?: string | undefined },
): string {
    const published = fields.published ? 1 : 0;
    return `INSERT INTO item (parent_path, item_name, item_type, published, summary, description)
        VALUES (${text(parentPath)}, ${text(itemName)}, 'album', ${published}, ${text(fields.summary)}, ${text(fields.description)})
        ON CONFLICT (parent_path, item_name) DO UPDATE
        SET published = excluded.published, summary = excluded.summary, description = excluded.description;`;
}

/** A SQL string literal, or NULL. */
function text(value: string | undefined): string {
    return value === undefined ? 'NULL' : `'${value.replaceAll("'", "''")}'`;
}

/** Runs the statements on the deployed database, with the account token the infrastructure config uses. */
async function sql(queries: string[]): Promise<void> {
    const file = path.join(tmpdir(), `import-album-${Date.now()}.sql`);
    await writeFile(file, queries.join('\n'));
    await new Promise<void>((resolve, reject) => {
        execFile(
            'npx',
            ['wrangler', 'd1', 'execute', 'DB', '--remote', ...target.wranglerEnv, '--yes', '--file', file],
            {
                cwd: API_DIR,
                env: { ...process.env, CLOUDFLARE_API_TOKEN: secrets['CLOUDFLARE_TERRAFORM_API_TOKEN'] ?? '' },
            },
            (error) => {
                if (error) {
                    reject(new Error('running the statements on D1 failed', { cause: error }));
                } else {
                    resolve();
                }
            },
        );
    });
}
