// What the recoveries from the old galleries share: an album a recovery describes is made unpublished with its words,
// each of its files is read from Dropbox through the read-only rclone remote, from the album's folder under
// `Photos/albums` or, failing that, `Photos/raw`, and uploaded as a browser uploads one, so the pipeline sizes it,
// reads its tags and makes its derived images, and then each photo's words, the album's thumbnail and its order are
// written.
//
// A run takes the directory holding the old gallery's exported rows, names its target with --to and its albums with
// --only or --all, and writes nothing without --go: without it, it finds every file and says what it would write. A
// rerun is a resume: it uploads only the photos the album does not list yet, leaves the words of an album that is
// already there as they are, and writes each photo's words again. An album's thumbnail and order are written until
// it is published, which is an admin having looked it over, and again only when the run adds photos to it. It stops
// at the first thing that goes wrong. Every write's outcome is a JSON line in `recover-<target>.jsonl` in the
// directory.
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
import { type Scope, type Target, parseScope, parseTarget } from './migration-run.ts';
import type { RecoveredAlbum, RecoveredMedia } from './recovered-album.ts';

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

/** One run of a recovery: where it reads its rows, what it writes to, and whether it writes at all. */
export interface Run {
    directory: string;
    target: Target;
    scope: Scope;
    go: boolean;
    to: Gallery;
}

/** A photo's file in Dropbox: the rclone path to read it from, and its size there. */
interface Source {
    from: string;
    bytes: number;
}

/** The run the arguments ask for, or `usage` when they name no directory. */
export async function parsedRun(args: readonly string[], usage: string): Promise<Run> {
    const [directory] = args;
    if (directory === undefined || directory.startsWith('--')) {
        throw new Error(usage);
    }
    const target = parseTarget(args, ['local', 'staging', 'production']);
    return {
        directory,
        target,
        scope: parseScope(args),
        go: args.includes('--go'),
        to: await galleryAt(target, 'moses'),
    };
}

/** Says what the album's recovery writes, and with --go writes it. */
export async function recover(run: Run, album: RecoveredAlbum): Promise<void> {
    const { to, target, go } = run;
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
        await ensureDraft(run, album);
    }
    const versions = new Map<string, string>();
    await inParallel(missing, UPLOADS_AT_ONCE, async (item) => {
        const source = sources.get(item.file);
        if (source === undefined) {
            throw new Error(`${item.file} has no file`);
        }
        const version = await upload(to, album.path, item.path, await fileOf(source), false);
        versions.set(item.name, version);
        log(run, { path: item.path, outcome: 'uploaded', from: source.from, versionId: version });
        console.log(`    uploaded ${item.path}`);
    });
    await untilProcessed(to, album.path, versions);
    for (const item of album.media) {
        await writeWords(run, item);
    }
    // A published album the run added nothing to keeps the thumbnail and order an admin may have given it since.
    if (versions.size === 0 && (await isPublished(to, album.path))) {
        console.log(`    done, the published album left as it is: ${to.site}${album.path.slice(0, -1)}`);
        return;
    }
    if (album.thumbnail !== null) {
        await write(to, 'PATCH', `/api/album-thumb${album.path}`, { mediaPath: album.thumbnail });
        log(run, { path: album.path, outcome: 'thumbnail', mediaPath: album.thumbnail });
    }
    if (album.order !== null) {
        await write(to, 'PUT', `/api/album-order${album.path}`, { itemNames: album.order });
        log(run, { path: album.path, outcome: 'ordered' });
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
            ...(item.tags.length === 0 ? [] : [`${String(item.tags.length)} tags`]),
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
async function ensureDraft(run: Run, album: RecoveredAlbum): Promise<void> {
    const { to } = run;
    const year = `/${album.path.split('/', 2)[1] ?? ''}/`;
    if (await createAlbum(to, year, { published: false })) {
        log(run, { path: year, outcome: 'created' });
    }
    const created = await createAlbum(to, album.path, {
        published: false,
        ...(album.summary !== null && { summary: album.summary }),
        ...(album.description !== null && { description: album.description }),
    });
    log(run, { path: album.path, outcome: created ? 'created' : 'already there, left as it is' });
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

/** What the old gallery said of the photo, over what its file said, and the thumbnail an admin cut. */
async function writeWords(run: Run, item: RecoveredMedia): Promise<void> {
    const { to } = run;
    if (item.title !== null || item.description !== null) {
        await write(to, 'PATCH', `/api/media${item.path}`, {
            ...(item.title !== null && { title: item.title }),
            ...(item.description !== null && { description: item.description }),
        });
    }
    if (item.crop !== null) {
        await write(to, 'PATCH', `/api/thumb${item.path}`, percentOf(item.crop, item.size));
    }
    log(run, { path: item.path, outcome: 'words written' });
}

/**
 * Where each of the album's photos is in Dropbox, by its file: in the first of the folders that holds the album's
 * whole set. A photo no folder holds, or one whose size is not the size the old gallery recorded, stops the run.
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
                    `${folder}/${day}/${name} is ${String(bytes)} bytes, and the old gallery's was ${String(item.bytes)}`,
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

/** The rows of a file of JSON lines, each held to `schema`. */
export async function jsonLines<Schema extends valibot.GenericSchema>(
    file: string,
    schema: Schema,
): Promise<valibot.InferOutput<Schema>[]> {
    const lines = (await readFile(file, 'utf8')).split('\n').filter((line) => line.trim() !== '');
    return lines.map((line) => valibot.parse(schema, JSON.parse(line)));
}

export function log(run: Run, entry: Record<string, unknown>): void {
    appendFileSync(
        path.join(run.directory, `recover-${run.target}.jsonl`),
        `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
    );
}
