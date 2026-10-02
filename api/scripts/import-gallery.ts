// Writes the AWS gallery's rows into this one through the Worker's admin routes, as the copy from AWS translates
// them. Against `wrangler dev` it is the check of the copy: every row goes through this Worker's write rules, and
// the report says what they refuse and what the copy changes.
//
// Each media item is renamed as the copy renames it, its extension dropped and the name sanitized, with `_n` where two
// in one day come out the same, a day album the calendar lacks is moved to a real day, and every link in a
// description or summary to an AWS media path is pointed at the new one. An album whose new names sort differently
// from its AWS names is put back in AWS's order. A thumbnail crop a few pixels past the image is trimmed to it, and
// one far off it dropped. An empty caption is left out. Each media row names the version id its original was copied
// under, from the file `mint-version-ids.ts` wrote; against `wrangler dev` without one, each is minted as the copy
// mints it. The writes go in the order the foreign keys want: year albums, day albums, media, each album's
// thumbnail, then the orders. Every write is a `PUT /api/item`, `PATCH /api/album-thumb` or `PUT /api/album-order`,
// each of which only sets what it is given, so a rerun over the same rows is a resume.
//
// It touches only the albums named with --only, with the year albums that hold them, or every row with --all, and
// writes nothing without --go: a run without it translates every row in scope and reports as the check does. Against
// staging or production it stops on a refused credential, on a request that fails three times, and at the fifth row
// the Worker refuses; against `wrangler dev` a refusal is a finding, reported with the rest. Every write's outcome is
// a JSON line in `import-gallery-<target>.jsonl`, beside the scan. The session cookie is signed with the target
// Worker's SESSION_SECRET, which api/.dev.vars holds for each: as SESSION_SECRET for local, and as
// SESSION_SECRET_STAGING and SESSION_SECRET_PRODUCTION the values `wrangler secret put` gave the deployed Workers.
//
// Usage: node api/scripts/import-gallery.ts prod-items.json --to local|staging|production
//            (--only <album path> ... | --all) [--ids version-ids.json] [--go] [--paths]
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import * as valibot from 'valibot';
import { parsePath } from '@tacocat-gallery/shared';
import { mintVersionId } from '../src/storage/keys.ts';
import { adminCookie } from './admin-cookie.ts';
import { copiedMediaPath, copyPlan } from './aws-copy-plan.ts';
import { copiedCrop } from './aws-crops.ts';
import { type RewrittenLink, copiedAlbumPath, rewriteLinks } from './aws-names.ts';
import { type AwsItem, awsPath, readScan } from './aws-scan.ts';
import { devVars } from './dev-vars.ts';
import {
    Guard,
    type Scope,
    type Target,
    albumInScope,
    inParallel,
    inScope,
    parseScope,
    parseTarget,
    send,
    value,
} from './migration-run.ts';
import { readVersionIds } from './version-ids-file.ts';

const USAGE =
    'Usage: node api/scripts/import-gallery.ts prod-items.json --to local|staging|production (--only <album path> ... | --all) [--ids version-ids.json] [--go] [--paths]';
const SITES = {
    local: 'http://localhost:8787',
    staging: 'https://staging-pix.tacocat.com',
    production: 'https://pix.deanmoses.com',
};
const AT_ONCE = 8;
const MAX_FAILURES = 5;
const PATHS_SHOWN = 5;
const PROGRESS_EVERY = 2000;

// A crop and a size as AWS stored them, once read out of the attribute values.
const RECTANGLE = valibot.object({
    x: valibot.number(),
    y: valibot.number(),
    width: valibot.number(),
    height: valibot.number(),
});
const SIZE = valibot.object({ width: valibot.number(), height: valibot.number() });
const THUMBNAIL = valibot.object({ path: valibot.string() });

/** One write to the Worker: its route, and the path it is about, for the report and the log. */
interface Write {
    method: 'PUT' | 'PATCH';
    route: string;
    body: unknown;
    path: string;
}

interface Refusal {
    path: string;
    message: string;
}

const { scanFile, target, scope, go, showEveryPath, idsFile } = parsedArgs(process.argv.slice(2));
const site = SITES[target];
const logFile = path.join(path.dirname(scanFile), `import-gallery-${target}.jsonl`);

const rows = await readScan(scanFile);
const plan = copyPlan(rows);
const ids = idsFile === undefined ? null : await readVersionIds(idsFile);
const links: { path: string; link: RewrittenLink }[] = [];
const trimmedCrops: string[] = [];
const droppedCrops: string[] = [];

// Every write in scope, in the order the foreign keys want.
const albums = rows.filter((row) => row.itemType === 'album' && albumInScope(scope, copiedAlbumPath(awsPath(row))));
const media = rows.filter(
    (row) => row.itemType === 'image' && inScope(scope, copiedMediaPath(plan, awsPath(row)) ?? ''),
);
const unknownTypes = rows.filter((row) => row.itemType !== 'album' && row.itemType !== 'image');
const writtenMedia = new Set(media.map((row) => awsPath(row)));
const phases: [string, Write[]][] = [
    ['year albums', albums.filter((row) => row.parentPath === '/').map((row) => itemWrite(row))],
    ['day albums', albums.filter((row) => row.parentPath !== '/').map((row) => itemWrite(row))],
    ['media', media.map((row) => itemWrite(row))],
    ['album thumbnails', albums.flatMap((row) => thumbnailWrite(row))],
    [
        "albums in AWS's order",
        [...plan.orders]
            .filter(([album]) => inScope(scope, album))
            .map(([album, itemNames]) => ({
                method: 'PUT' as const,
                route: `/api/album-order${album}`,
                body: { itemNames },
                path: album,
            })),
    ],
];

console.log(
    `${String(rows.length)} rows in ${scanFile}; ${go ? `writing to ${site}` : `dry run for ${site}, writing nothing`}`,
);
const guard = new Guard(target === 'local' ? Infinity : MAX_FAILURES);
const cookie = go ? await adminCookie(await sessionSecret(), 'moses') : '';
const refusals: Refusal[] = [];
for (const [phase, writes] of phases) {
    if (!go) {
        console.log(
            `  ${String(writes.length)} ${phase}${writes.length > 0 ? `, the first ${writes[0]?.path ?? ''}` : ''}`,
        );
        continue;
    }
    if (guard.halted !== null) {
        break;
    }
    let written = 0;
    let refused = 0;
    await inParallel(guard, writes, AT_ONCE, async (write) => {
        const found = await sent(write);
        if (found === null) {
            return;
        }
        if (found.length === 0) {
            written += 1;
        } else {
            refused += 1;
            refusals.push(...found);
        }
        if ((written + refused) % PROGRESS_EVERY === 0) {
            console.log(`    ${String(written + refused)} of ${String(writes.length)} ${phase}`);
        }
    });
    console.log(
        `  ${phase}: ${String(written)} written, ${String(refused)} refused, ${String(writes.length - written - refused)} not reached, of ${String(writes.length)}`,
    );
}
if (unknownTypes.length > 0) {
    console.log(`${String(unknownTypes.length)} rows of a type this gallery has no row for`);
}
report(refusals);
report(danglingThumbnails());
reportCrops();
reportRenames();
reportLinks();
if (guard.halted !== null) {
    console.log(`\nStopped: ${guard.halted}`);
    process.exitCode = 1;
}

/**
 * Sends the write and returns each reason it was refused, nothing once it is in, or null once the run has stopped.
 * The shared schema's message lists every field it refused, one `× reason` and `→ at field` pair each, and those
 * become one refusal apiece, so the report counts rules rather than combinations of them.
 */
async function sent(write: Write): Promise<Refusal[] | null> {
    const response = await send(guard, `${write.method} ${write.route}`, async () =>
        fetch(new URL(write.route, site), {
            method: write.method,
            headers: { cookie, 'content-type': 'application/json' },
            body: JSON.stringify(write.body),
        }),
    );
    if (response === null) {
        return null;
    }
    const text = await response.text();
    const outcome = response.ok ? 'written' : `refused ${String(response.status)}`;
    appendFileSync(
        logFile,
        `${JSON.stringify({ at: new Date().toISOString(), route: write.route, path: write.path, outcome, ...(!response.ok && { answer: text.slice(0, 500) }) })}\n`,
    );
    if (response.ok) {
        return [];
    }
    if (target !== 'local') {
        guard.fail(`${write.path}: ${String(response.status)} ${text.slice(0, 200)}`);
    }
    const parsed = valibot.safeParse(valibot.object({ errorMessage: valibot.string() }), parseJson(text));
    const message = parsed.success ? parsed.output.errorMessage : `${String(response.status)} ${text}`;
    const issues = message
        .split(/^× /mv)
        .filter((issue) => issue !== '')
        .map((issue) => issue.replace(/\n[\t ]*→ at /v, ' at ').trim());
    return issues.map((issue) => ({ path: write.path, message: issue }));
}

/**
 * The row as the Worker takes it, with AWS's fields under their names here and nothing invented for a missing one: an
 * item under its new path, a media item with the version id its original was copied under, and every caption with its
 * links rewritten.
 */
function itemWrite(row: AwsItem): Write {
    const itemPath = awsPath(row);
    if (row.itemType === 'album') {
        const copied = parsePath(copiedAlbumPath(itemPath));
        const itemName = copied === null || copied.kind === 'root' ? row.itemName : copied.name;
        return {
            method: 'PUT',
            route: '/api/item',
            path: copiedAlbumPath(itemPath),
            body: {
                parentPath: row.parentPath,
                itemName,
                ...(isCaption(row.description) && { description: rewritten(itemPath, row.description) }),
                itemType: 'album',
                ...(isCaption(row.summary) && { summary: rewritten(itemPath, row.summary) }),
                ...(row.published !== undefined && { published: row.published }),
            },
        };
    }
    const versionId = versionIdOf(itemPath, row);
    return {
        method: 'PUT',
        route: '/api/item',
        path: copiedMediaPath(plan, itemPath) ?? itemPath,
        body: {
            parentPath: row.parentPath === undefined ? undefined : copiedAlbumPath(row.parentPath),
            itemName: plan.renames.get(itemPath)?.to ?? row.itemName,
            ...(isCaption(row.description) && { description: rewritten(itemPath, row.description) }),
            itemType: 'media',
            mediaType: row.mediaType === 'video' ? 'video' : 'image',
            ...(isCaption(row.title) && { title: row.title }),
            ...(row.tags !== undefined && { tags: row.tags }),
            ...(versionId !== undefined && { versionId }),
            width: row.dimensions?.width,
            height: row.dimensions?.height,
            ...(row.duration !== undefined && { durationSeconds: row.duration }),
            ...(row.thumbnail !== undefined && croppedAs(itemPath, row)),
        },
    };
}

/**
 * The id the row's original was copied under, or against `wrangler dev` without a file, one minted as the copy would.
 */
function versionIdOf(itemPath: string, row: AwsItem): string | undefined {
    if (row.versionId === undefined) {
        return undefined;
    }
    return ids === null ? mintVersionId() : ids[itemPath]?.versionId;
}

/** The album's thumbnail, when it names a media item this run writes; one it cannot is reported with the refusals. */
function thumbnailWrite(row: AwsItem): Write[] {
    const thumbnail = valibot.safeParse(THUMBNAIL, row.thumbnail);
    const mediaPath = thumbnail.success ? copiedMediaPath(plan, thumbnail.output.path) : null;
    if (!thumbnail.success || mediaPath === null || !writtenMedia.has(thumbnail.output.path)) {
        return [];
    }
    const album = copiedAlbumPath(awsPath(row));
    return [{ method: 'PATCH', route: `/api/album-thumb${album}`, body: { mediaPath }, path: album }];
}

/** The row's crop as the copy writes it, or nothing for one it drops; a crop it cannot read goes as it came. */
function croppedAs(itemPath: string, row: AwsItem): { thumbnailCrop?: unknown } {
    const crop = valibot.safeParse(RECTANGLE, row.thumbnail);
    const size = valibot.safeParse(SIZE, row.dimensions);
    if (!crop.success || !size.success) {
        return { thumbnailCrop: row.thumbnail };
    }
    const copied = copiedCrop(crop.output, size.output);
    if (copied === null) {
        droppedCrops.push(itemPath);
        return {};
    }
    if (copied !== crop.output) {
        trimmedCrops.push(itemPath);
    }
    return { thumbnailCrop: copied };
}

/**
 * Whether AWS held a caption for the field. It stored an empty string where an admin had cleared one, which this
 * gallery writes as no caption at all; anything else goes as it came, for the Worker to judge.
 */
function isCaption(text: unknown): boolean {
    return text !== undefined && !(typeof text === 'string' && text.trim() === '');
}

/** A caption with its links to AWS media paths pointed at the new paths, each link noted for the report. */
function rewritten(itemPath: string, caption: unknown): unknown {
    if (typeof caption !== 'string') {
        return caption;
    }
    const result = rewriteLinks(caption, (linked) => copiedMediaPath(plan, linked));
    links.push(...result.links.map((link) => ({ path: itemPath, link })));
    return result.html;
}

/** Album thumbnails in scope that name a media item the scan does not hold, which the copy cannot point at. */
function danglingThumbnails(): Refusal[] {
    return albums
        .filter((row) => row.thumbnail !== undefined)
        .flatMap((row) => {
            const thumbnail = valibot.safeParse(THUMBNAIL, row.thumbnail);
            const album = copiedAlbumPath(awsPath(row));
            if (!thumbnail.success) {
                return [{ path: album, message: 'album thumbnail is not { path }' }];
            }
            return plan.renames.has(thumbnail.output.path)
                ? []
                : [{ path: album, message: 'album thumbnail names a media item that has no row' }];
        });
}

/** Every crop dropped, since each needs an admin to cut it again, and with --paths every one trimmed, to look at. */
function reportCrops(): void {
    console.log();
    console.log(
        `${String(trimmedCrops.length)} thumbnail crops trimmed to the image, ${String(droppedCrops.length)} dropped`,
    );
    for (const dropped of droppedCrops) {
        console.log(`    dropped: ${dropped}`);
    }
    if (showEveryPath) {
        for (const trimmed of trimmedCrops) {
            console.log(`    trimmed: ${trimmed}`);
        }
    }
}

/** Every name the copy changes in scope, the sanitized ones in brief and every collision in full. */
function reportRenames(): void {
    const changed = media
        .map((row) => awsPath(row))
        .flatMap((itemPath) => {
            const renamed = plan.renames.get(itemPath);
            return renamed === undefined || renamed.from === renamed.to ? [] : [{ itemPath, renamed }];
        });
    const collided = changed.filter(({ renamed }) => renamed.collided);
    console.log();
    console.log(
        `${String(changed.length)} of ${String(media.length)} media names change, ${String(collided.length)} of them to a _n the copy gave them`,
    );
    const shown = showEveryPath ? changed : changed.slice(0, PATHS_SHOWN);
    for (const { itemPath, renamed } of shown) {
        console.log(`    ${itemPath} → ${renamed.to}`);
    }
    if (shown.length < changed.length) {
        console.log(`    … and ${String(changed.length - shown.length)} more (--paths lists them)`);
    }
    for (const { itemPath, renamed } of collided) {
        console.log(`    collision: ${itemPath} → ${renamed.to}`);
    }
}

/** Every link to an AWS media path, rewritten or not, since an unresolved one stays as it was and needs a person. */
function reportLinks(): void {
    const unresolved = links.filter(({ link }) => link.to === null);
    console.log();
    console.log(
        `${String(links.length)} links to media rewritten in captions, ${String(unresolved.length)} of them unresolved and left as they were`,
    );
    for (const { path: at, link } of unresolved) {
        console.log(`    ${at}: ${link.from}`);
    }
    if (showEveryPath) {
        for (const { path: at, link } of links.filter((entry) => entry.link.to !== null)) {
            console.log(`    ${at}: ${link.from} → ${link.to ?? ''}`);
        }
    }
}

/** The refusals grouped by message, most common first, each with a few of its paths, or all of them with --paths. */
function report(found: Refusal[]): void {
    const byMessage = Map.groupBy(found, (refusal) => refusal.message);
    for (const [message, group] of [...byMessage].toSorted(([, first], [, second]) => second.length - first.length)) {
        console.log();
        console.log(`${String(group.length)}× ${message}`);
        const shown = showEveryPath ? group : group.slice(0, PATHS_SHOWN);
        for (const refusal of shown) {
            console.log(`    ${refusal.path}`);
        }
        if (shown.length < group.length) {
            console.log(`    … and ${String(group.length - shown.length)} more (--paths lists them)`);
        }
    }
}

function parsedArgs(args: string[]): {
    scanFile: string;
    target: Target;
    scope: Scope;
    go: boolean;
    showEveryPath: boolean;
    idsFile: string | undefined;
} {
    const [file] = args;
    if (file === undefined || file.startsWith('--')) {
        throw new Error(USAGE);
    }
    const named = parseTarget(args, ['local', 'staging', 'production']);
    const idsArg = value(args, '--ids');
    if (idsArg === undefined && named !== 'local') {
        throw new Error(
            'Staging and production take each version id from --ids, the file the originals were copied under',
        );
    }
    return {
        scanFile: file,
        target: named,
        scope: parseScope(args),
        go: args.includes('--go'),
        showEveryPath: args.includes('--paths'),
        idsFile: idsArg,
    };
}

async function sessionSecret(): Promise<string> {
    const name = target === 'local' ? 'SESSION_SECRET' : `SESSION_SECRET_${target.toUpperCase()}`;
    const secret = (await devVars())[name] ?? '';
    if (secret === '') {
        throw new Error(`${name} is not set in api/.dev.vars`);
    }
    return secret;
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}
