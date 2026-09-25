// Runs every row of the AWS gallery through this Worker's write rules, and reports what they refuse. The rows come
// from a DynamoDB scan of the items table, saved as the CLI writes it:
//
//   aws dynamodb scan --table-name tacocat-gallery-sam-prod-items --output json > prod-items.json
//
// Each becomes a `PUT /api/item` to a Worker, `wrangler dev` by default, which answers 400 with the shared schema's
// message or the constraint's name for a row it refuses. The report groups the refusals by message, with the paths.
// Nothing is repaired here: the report says which rows the copy has to repair, and which rule, if any, to loosen.
//
// Usage: node api/scripts/check-gallery.ts prod-items.json [--site http://localhost:8787] [--paths]
import { readFile } from 'node:fs/promises';
import * as valibot from 'valibot';
import { adminCookie } from './admin-cookie.ts';
import { devVars } from './dev-vars.ts';

const file = process.argv[2];
if (file === undefined || file.startsWith('--')) {
    throw new Error(
        'Usage: node api/scripts/check-gallery.ts prod-items.json [--site http://localhost:8787] [--paths]',
    );
}
const siteAt = process.argv.indexOf('--site');
const site = siteAt === -1 ? 'http://localhost:8787' : (process.argv[siteAt + 1] ?? '');
const showEveryPath = process.argv.includes('--paths');

const AT_ONCE = 8;
const PATHS_SHOWN = 5;

// A DynamoDB attribute value, as the CLI prints it: one key naming the type.
const ATTRIBUTE: valibot.GenericSchema<unknown, unknown> = valibot.lazy(() =>
    valibot.union([
        valibot.pipe(
            valibot.object({ S: valibot.string() }),
            valibot.transform((value): unknown => value.S),
        ),
        valibot.pipe(
            valibot.object({ N: valibot.string() }),
            valibot.transform((value): unknown => Number(value.N)),
        ),
        valibot.pipe(
            valibot.object({ BOOL: valibot.boolean() }),
            valibot.transform((value): unknown => value.BOOL),
        ),
        valibot.pipe(
            valibot.object({ NULL: valibot.boolean() }),
            valibot.transform((): unknown => null),
        ),
        valibot.pipe(
            valibot.object({ L: valibot.array(ATTRIBUTE) }),
            valibot.transform((value): unknown => value.L),
        ),
        valibot.pipe(
            valibot.object({ SS: valibot.array(valibot.string()) }),
            valibot.transform((value): unknown => value.SS),
        ),
        valibot.pipe(
            valibot.object({ M: valibot.record(valibot.string(), ATTRIBUTE) }),
            valibot.transform((value): unknown => value.M),
        ),
    ]),
);
// The CLI's output: an object whose Items are the rows.
const SCAN = valibot.pipe(
    valibot.record(valibot.string(), valibot.unknown()),
    valibot.transform((scan): unknown => scan['Items']),
    valibot.array(valibot.record(valibot.string(), ATTRIBUTE)),
);

// An item as AWS stored it: 'image' is any media, and a video says so in mediaType. Every field is optional here so
// that a row missing one reaches the Worker and is refused there, where the refusal is the finding.
const AWS_ITEM = valibot.looseObject({
    parentPath: valibot.optional(valibot.string()),
    itemName: valibot.optional(valibot.string()),
    itemType: valibot.optional(valibot.string()),
    mediaType: valibot.optional(valibot.string()),
    title: valibot.optional(valibot.unknown()),
    description: valibot.optional(valibot.unknown()),
    summary: valibot.optional(valibot.unknown()),
    tags: valibot.optional(valibot.unknown()),
    published: valibot.optional(valibot.unknown()),
    versionId: valibot.optional(valibot.unknown()),
    dimensions: valibot.optional(valibot.looseObject({ width: valibot.unknown(), height: valibot.unknown() })),
    duration: valibot.optional(valibot.unknown()),
    thumbnail: valibot.optional(valibot.unknown()),
});
type AwsItem = valibot.InferOutput<typeof AWS_ITEM>;

interface Refusal {
    path: string;
    message: string;
}

const rows = valibot.parse(SCAN, JSON.parse(await readFile(file, 'utf8'))).map((raw) => valibot.parse(AWS_ITEM, raw));
const cookie = await adminCookie((await devVars())['SESSION_SECRET'] ?? '', 'check-gallery');
console.log(`${rows.length} rows in ${file}; writing each to ${site}`);

const unknownTypes = rows.filter((row) => row.itemType !== 'album' && row.itemType !== 'image');
const refusals: Refusal[] = [];
let written = 0;
let refused = 0;
await inParallel(
    rows.filter((row) => !unknownTypes.includes(row)),
    AT_ONCE,
    async (row) => {
        const itemPath = `${row.parentPath ?? '?'}${row.itemName ?? '?'}${row.itemType === 'album' ? '/' : ''}`;
        const found = await put(toWrite(row), itemPath);
        if (found.length === 0) {
            written += 1;
        } else {
            refused += 1;
            refusals.push(...found);
        }
        const done = written + refused;
        if (done % 2000 === 0) {
            console.log(`  ${done} of ${rows.length}`);
        }
    },
);

console.log();
console.log(`${written} written, ${refused} refused, ${unknownTypes.length} of a type this gallery has no row for`);
report(refusals);
report(danglingThumbnails(rows));

/** The write this Worker takes, with AWS's fields under their names here and nothing invented for a missing one. */
function toWrite(row: AwsItem): unknown {
    const shared = {
        parentPath: row.parentPath,
        itemName: row.itemName,
        ...(row.description !== undefined && { description: row.description }),
    };
    if (row.itemType === 'album') {
        return {
            ...shared,
            itemType: 'album',
            ...(row.summary !== undefined && { summary: row.summary }),
            ...(row.published !== undefined && { published: row.published }),
        };
    }
    return {
        ...shared,
        itemType: 'media',
        mediaType: row.mediaType === 'video' ? 'video' : 'image',
        ...(row.title !== undefined && { title: row.title }),
        ...(row.tags !== undefined && { tags: row.tags }),
        versionId: row.versionId,
        width: row.dimensions?.width,
        height: row.dimensions?.height,
        ...(row.duration !== undefined && { durationSeconds: row.duration }),
        ...(row.thumbnail !== undefined && { thumbnailCrop: row.thumbnail }),
    };
}

/**
 * Writes the row and returns each reason it was refused, or nothing once it is in. Anything but a 400 is a fault in
 * the run. The shared schema's message lists every field it refused, one `× reason` and `→ at field` pair each, and
 * those become one refusal apiece, so the report counts rules rather than combinations of them.
 */
async function put(body: unknown, itemPath: string): Promise<Refusal[]> {
    const response = await fetch(new URL('/api/item', site), {
        method: 'PUT',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (response.ok) {
        return [];
    }
    const text = await response.text();
    if (response.status !== 400) {
        throw new Error(`${itemPath}: ${response.status} ${text}`);
    }
    const parsed = valibot.safeParse(valibot.object({ errorMessage: valibot.string() }), parseJson(text));
    const message = parsed.success ? parsed.output.errorMessage : text;
    const issues = message
        .split(/^× /mv)
        .filter((issue) => issue !== '')
        .map((issue) => issue.replace(/\n[\t ]*→ at /v, ' at ').trim());
    return issues.map((issue) => ({ path: itemPath, message: issue }));
}

/** Album thumbnails that name a media row the export does not hold, which the copy could not point at. */
function danglingThumbnails(items: AwsItem[]): Refusal[] {
    const mediaPaths = new Set(
        items.filter((row) => row.itemType === 'image').map((row) => `${row.parentPath ?? ''}${row.itemName ?? ''}`),
    );
    const named = valibot.object({ path: valibot.string() });
    return items
        .filter((row) => row.itemType === 'album' && row.thumbnail !== undefined)
        .flatMap((row) => {
            const thumbnail = valibot.safeParse(named, row.thumbnail);
            const albumPath = `${row.parentPath ?? ''}${row.itemName ?? ''}/`;
            if (!thumbnail.success) {
                return [{ path: albumPath, message: 'album thumbnail is not { path }' }];
            }
            return mediaPaths.has(thumbnail.output.path)
                ? []
                : [{ path: albumPath, message: 'album thumbnail names a media item that has no row' }];
        });
}

/** The refusals grouped by message, most common first, each with a few of its paths, or all of them with --paths. */
function report(found: Refusal[]): void {
    const byMessage = Map.groupBy(found, (refusal) => refusal.message);
    for (const [message, group] of [...byMessage].toSorted(([, first], [, second]) => second.length - first.length)) {
        console.log();
        console.log(`${group.length}× ${message}`);
        const shown = showEveryPath ? group : group.slice(0, PATHS_SHOWN);
        for (const refusal of shown) {
            console.log(`    ${refusal.path}`);
        }
        if (shown.length < group.length) {
            console.log(`    … and ${group.length - shown.length} more (--paths lists them)`);
        }
    }
}

async function inParallel<T>(items: T[], atOnce: number, work: (item: T) => Promise<void>): Promise<void> {
    const queue = [...items];
    await Promise.all(
        Array.from({ length: atOnce }, async () => {
            for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
                await work(next);
            }
        }),
    );
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}
