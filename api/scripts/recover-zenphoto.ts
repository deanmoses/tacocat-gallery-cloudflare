// Brings over what the 2023 move from Zenphoto to AWS left behind: the day albums Zenphoto never published, each
// made here unpublished for an admin to look over and publish, and a photo hidden inside an album that was published.
// The words, names and order come from Zenphoto's database as `zenphoto.ts` translates them. Each file comes from
// Dropbox, read through the read-only rclone remote from the album's folder under `Photos/albums` or, failing that,
// `Photos/raw`, and goes in through the Worker's own upload, so the pipeline sizes it, reads its tags and makes its
// derived images.
//
// It takes the directory holding Zenphoto's `albums.jsonl` and `images.jsonl`, and touches only the albums named with
// --only, or with --all every unpublished album. A photo hidden inside a published album shows as soon as it is
// added, so --all leaves those out: such an album has to be named. It writes nothing without --go: a run without it
// finds every file and says what it would write. A rerun is a resume: it uploads only the photos the album does not
// list yet, leaves the words of an album that is already there as they are, and writes each photo's words again. An
// album's thumbnail and order are written until it is published, which is an admin having looked it over, and again
// only when the run adds photos to it.
// It stops at the first thing that goes wrong. Every write's outcome is a JSON line in `recover-<target>.jsonl` in
// the same directory.
//
// Usage: node api/scripts/recover-zenphoto.ts <zenphoto dir> --to local|staging|production
//            (--only <album path> ... | --all) [--go]
import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as valibot from 'valibot';
import {
    type Gallery,
    createAlbum,
    galleryAt,
    inParallel,
    listedVersions,
    percentOf,
    untilProcessed,
    upload,
    write,
} from './gallery-upload.ts';
import { inScope, parseScope, parseTarget } from './migration-run.ts';
import { type RecoveredAlbum, type RecoveredMedia, recoveryPlan } from './zenphoto.ts';

const USAGE =
    'Usage: node api/scripts/recover-zenphoto.ts <zenphoto dir> --to local|staging|production (--only <album path> ... | --all) [--go]';
// The published albums first, then the raw originals behind them.
const DROPBOX_FOLDERS = ['dropbox-ro:Photos/albums', 'dropbox-ro:Photos/raw'];
const CONTENT_TYPES = new Map([
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.png', 'image/png'],
    ['.gif', 'image/gif'],
]);
const UPLOADS_AT_ONCE = 4;
const LARGEST_FILE_BYTES = 512 * 1024 * 1024;

const NULLABLE_TEXT = valibot.nullable(valibot.string());
const NULLABLE_NUMBER = valibot.nullable(valibot.number());
const ALBUM = valibot.object({
    id: valibot.number(),
    folder: valibot.string(),
    show: valibot.number(),
    desc: NULLABLE_TEXT,
    custom_data: NULLABLE_TEXT,
    thumb: NULLABLE_TEXT,
});
const IMAGE = valibot.object({
    albumid: valibot.number(),
    filename: valibot.string(),
    show: valibot.number(),
    title: NULLABLE_TEXT,
    desc: NULLABLE_TEXT,
    width: valibot.number(),
    height: valibot.number(),
    thumbX: NULLABLE_NUMBER,
    thumbY: NULLABLE_NUMBER,
    thumbW: NULLABLE_NUMBER,
    thumbH: NULLABLE_NUMBER,
    filesize: NULLABLE_NUMBER,
    tags: valibot.nullable(valibot.array(valibot.string())),
});

/** A photo's file in Dropbox: the rclone path to read it from, and its size there. */
interface Source {
    from: string;
    bytes: number;
}

const args = process.argv.slice(2);
const directory = directoryOf(args);
const target = parseTarget(args, ['local', 'staging', 'production']);
const scope = parseScope(args);
const go = args.includes('--go');
const logFile = path.join(directory, `recover-${target}.jsonl`);

const plan = recoveryPlan(
    await jsonLines(path.join(directory, 'albums.jsonl'), ALBUM),
    await jsonLines(path.join(directory, 'images.jsonl'), IMAGE),
);
const albums = plan.filter((album) =>
    album.draft ? inScope(scope, album.path) : !scope.all && scope.albums.includes(album.path),
);
const gallery = await galleryAt(target, 'moses');
console.log(
    `${String(albums.length)} of Zenphoto's ${String(plan.length)} albums with something unpublished; ${go ? `writing to ${gallery.site}` : `dry run for ${gallery.site}, writing nothing`}`,
);
for (const album of albums) {
    await recover(gallery, album);
}

/** Says what the album's recovery writes, and with --go writes it. */
async function recover(to: Gallery, album: RecoveredAlbum): Promise<void> {
    const sources = await sourcesOf(album);
    const listed = await listedVersions(to, album.path);
    const missing = album.media.filter((item) => listed?.has(item.name) !== true);
    const total = album.media.reduce((sum, item) => sum + (sources.get(item.file)?.bytes ?? 0), 0);
    console.log(
        `\n${album.path}: ${album.draft ? 'unpublished album' : 'photos hidden in a published album'}, ${String(album.media.length)} photos, ${(total / 1e6).toFixed(1)} MB from ${folderOf(sources)}`,
    );
    console.log(
        `    on ${target}: ${listed === null ? 'no such album' : `the album is there, with ${String(album.media.length - missing.length)} of them`}; ${String(missing.length)} to upload`,
    );
    describe(album);
    if (!album.draft && listed === null) {
        throw new Error(`${album.path} is not on ${target}, and the recovery only adds photos to it`);
    }
    if (!go) {
        return;
    }
    if (album.draft) {
        await ensureDraft(to, album);
    }
    const versions = new Map<string, string>();
    await inParallel(missing, UPLOADS_AT_ONCE, async (item) => {
        const source = sources.get(item.file);
        if (source === undefined) {
            throw new Error(`${item.file} has no file`);
        }
        const version = await upload(to, album.path, item.path, await fileOf(source), false);
        versions.set(item.name, version);
        log({ path: item.path, outcome: 'uploaded', from: source.from, versionId: version });
        console.log(`    uploaded ${item.path}`);
    });
    await untilProcessed(to, album.path, versions);
    for (const item of album.media) {
        await writeWords(to, item);
    }
    // A published album the run added nothing to keeps the thumbnail and order an admin may have given it since.
    if (versions.size === 0 && (await isPublished(to, album.path))) {
        console.log(`    done, the published album left as it is: ${to.site}${album.path.slice(0, -1)}`);
        return;
    }
    if (album.thumbnail !== null) {
        await write(to, 'PATCH', `/api/album-thumb${album.path}`, { mediaPath: album.thumbnail });
        log({ path: album.path, outcome: 'thumbnail', mediaPath: album.thumbnail });
    }
    if (album.order !== null) {
        await write(to, 'PUT', `/api/album-order${album.path}`, { itemNames: album.order });
        log({ path: album.path, outcome: 'ordered' });
    }
    console.log(`    done: ${to.site}${album.path.slice(0, -1)}`);
}

/** The album's words and whatever the recovery changes or sets beyond uploading its photos. */
function describe(album: RecoveredAlbum): void {
    if (album.draft) {
        console.log(`    summary: ${album.summary ?? 'none'}`);
        console.log(`    description: ${album.description === null ? 'none' : brief(album.description)}`);
        console.log(`    thumbnail: ${album.thumbnail ?? 'none'}`);
    }
    if (album.order !== null) {
        console.log(`    order: ${album.order.join(', ')}`);
    }
    for (const item of album.media) {
        const stem = path.parse(item.file).name;
        const notes = [
            ...(item.name === stem ? [] : [`from ${path.basename(item.file)}`]),
            ...(item.crop === null ? [] : ['thumbnail crop']),
            ...(item.tags.length === 0 ? [] : [`${String(item.tags.length)} tags in Zenphoto`]),
        ];
        console.log(
            `    ${item.name}: ${item.title ?? 'no title'}${item.description === null ? '' : `; ${brief(item.description)}`}${notes.length === 0 ? '' : ` [${notes.join('; ')}]`}`,
        );
    }
}

function brief(text: string): string {
    return text.length <= 70 ? text : `${text.slice(0, 70)}…`;
}

/**
 * Makes the album unpublished with its words, inside a year that is made unpublished too if the gallery lacks it. An
 * album already there keeps its words and whether it is published, since an admin may have edited or published it.
 */
async function ensureDraft(to: Gallery, album: RecoveredAlbum): Promise<void> {
    const year = `/${album.path.split('/', 2)[1] ?? ''}/`;
    if (await createAlbum(to, year, { published: false })) {
        log({ path: year, outcome: 'created' });
    }
    const created = await createAlbum(to, album.path, {
        published: false,
        ...(album.summary !== null && { summary: album.summary }),
        ...(album.description !== null && { description: album.description }),
    });
    log({ path: album.path, outcome: created ? 'created' : 'already there, left as it is' });
}

async function isPublished(to: Gallery, albumPath: string): Promise<boolean> {
    const response = await fetch(`${to.site}/api/album${albumPath}?consistency=primary`, {
        headers: { cookie: to.cookie },
    });
    const album = valibot.parse(
        valibot.object({ published: valibot.optional(valibot.boolean()) }),
        await response.json(),
    );
    return album.published === true;
}

/** What Zenphoto said of the photo, over what its file said, and the thumbnail an admin cut. */
async function writeWords(to: Gallery, item: RecoveredMedia): Promise<void> {
    if (item.title !== null || item.description !== null) {
        await write(to, 'PATCH', `/api/media${item.path}`, {
            ...(item.title !== null && { title: item.title }),
            ...(item.description !== null && { description: item.description }),
        });
    }
    if (item.crop !== null) {
        await write(to, 'PATCH', `/api/thumb${item.path}`, percentOf(item.crop, item.size));
    }
    log({ path: item.path, outcome: 'words written' });
}

/**
 * Where each of the album's photos is in Dropbox, by its Zenphoto file: in the first of the folders that holds the
 * album's whole set. A photo no folder holds, or one whose size is not the size Zenphoto recorded, stops the run.
 */
async function sourcesOf(album: RecoveredAlbum): Promise<Map<string, Source>> {
    const day = album.path.slice(1, -1);
    const lacking: string[] = [];
    for (const folder of DROPBOX_FOLDERS) {
        const sizes = await listing(`${folder}/${day}`);
        const absent = album.media.filter((item) => !sizes.has(path.basename(item.file)));
        if (absent.length > 0) {
            lacking.push(`${folder}/${day} lacks ${absent.map((item) => path.basename(item.file)).join(', ')}`);
            continue;
        }
        const sources = new Map<string, Source>();
        for (const item of album.media) {
            const name = path.basename(item.file);
            const bytes = sizes.get(name) ?? 0;
            if (bytes === 0 || (item.bytes !== null && item.bytes !== bytes)) {
                throw new Error(
                    `${folder}/${day}/${name} is ${String(bytes)} bytes, and Zenphoto's was ${String(item.bytes)}`,
                );
            }
            sources.set(item.file, { from: `${folder}/${day}/${name}`, bytes });
        }
        return sources;
    }
    throw new Error(`No Dropbox folder holds ${album.path}: ${lacking.join('; ')}`);
}

function folderOf(sources: Map<string, Source>): string {
    const [first] = sources.values();
    return first === undefined ? 'nowhere' : path.dirname(first.from);
}

/** Each file's size in a Dropbox folder, by its name; nothing for a folder Dropbox lacks. */
async function listing(folder: string): Promise<Map<string, number>> {
    let lines: string;
    try {
        lines = (await rclone(['lsf', '--files-only', '--format', 'sp', '--separator', '\t', folder])).toString('utf8');
    } catch (error) {
        if (error instanceof Error && error.message.includes('directory not found')) {
            return new Map();
        }
        throw error;
    }
    return new Map(
        lines
            .split('\n')
            .filter((line) => line !== '')
            .map((line) => {
                const cut = line.indexOf('\t');
                return [line.slice(cut + 1), Number(line.slice(0, cut))];
            }),
    );
}

/** What an rclone command printed, or its complaint as the error. */
async function rclone(command: string[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        execFile('rclone', command, { encoding: 'buffer', maxBuffer: LARGEST_FILE_BYTES }, (error, stdout, stderr) => {
            if (error === null) {
                resolve(stdout);
            } else {
                reject(new Error(`rclone ${command.join(' ')}: ${stderr.toString('utf8').trim()}`, { cause: error }));
            }
        });
    });
}

/** The file read from Dropbox, whole, as the upload sends it. */
async function fileOf(source: Source): Promise<{ body: ArrayBuffer; contentType: string }> {
    const contentType = CONTENT_TYPES.get(path.extname(source.from).toLowerCase());
    if (contentType === undefined) {
        throw new Error(`${source.from} is of a type the recovery does not upload`);
    }
    const stdout = await rclone(['cat', source.from]);
    if (stdout.byteLength !== source.bytes) {
        throw new Error(`${source.from} came as ${String(stdout.byteLength)} bytes of ${String(source.bytes)}`);
    }
    return { body: new Uint8Array(stdout).buffer, contentType };
}

function directoryOf(given: readonly string[]): string {
    const [first] = given;
    if (first === undefined || first.startsWith('--')) {
        throw new Error(USAGE);
    }
    return first;
}

async function jsonLines<Schema extends valibot.GenericSchema>(
    file: string,
    schema: Schema,
): Promise<valibot.InferOutput<Schema>[]> {
    const lines = (await readFile(file, 'utf8')).split('\n').filter((line) => line.trim() !== '');
    return lines.map((line) => valibot.parse(schema, JSON.parse(line)));
}

function log(entry: Record<string, unknown>): void {
    appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}
