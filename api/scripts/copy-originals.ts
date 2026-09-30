// The rename pass of the copy from AWS: copies each original, which Super Slurper left in an import bucket under its
// AWS key, to `originals/<versionId>` in the target's originals bucket, under the id `mint-version-ids.ts` gave it. The
// bytes never leave R2: each is one `CopyObject`. For each original it asks whether the target already holds it, and
// skips one it does, so a rerun copies only what the last run did not; then reads the source's first bytes, refuses a
// source whose size or ETag is not that of the S3 file the id was minted for, which is what a photo replaced on AWS
// after the import bucket was filled looks like, and judges the bytes with the Worker's own sniffer, which gives the
// content type as an upload's is given and refuses a file the gallery could not serve; then copies it, with the content
// type and with its gallery path and S3 version id as metadata; then checks the copy's size against the source's.
// Newest albums go first.
//
// It touches only the albums named with --only, or every original with --all, and copies nothing without --go: a run
// without it reads and judges every original in scope and says what it would copy. It stops on a refused credential,
// on a request that fails three times, and at the fifth original that goes wrong. Every original's outcome is a JSON
// line in `copy-originals-<target>.jsonl`, beside the version id file. It runs with the OpenTofu token in
// api/.dev.vars, since the Worker's own key cannot write originals.
//
// Usage: node api/scripts/copy-originals.ts version-ids.json --from <import bucket> --to staging|production
//            (--only <album path> ... | --all) [--go]
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { AwsClient } from 'aws4fetch';
import { SNIFF_LENGTH, sniffMedia } from '../src/media/sniff.ts';
import { originalKey } from '../src/storage/keys.ts';
import { ACCOUNT_ID } from '../src/storage/s3.ts';
import { devVars } from './dev-vars.ts';
import { Guard, type Scope, inParallel, inScope, parseScope, parseTarget, send, value } from './migration-run.ts';
import { tokenCredentials } from './r2-token.ts';
import { type VersionIds, readVersionIds } from './version-ids-file.ts';

const USAGE =
    'Usage: node api/scripts/copy-originals.ts version-ids.json --from <import bucket> --to staging|production (--only <album path> ... | --all) [--go]';
const BUCKETS = { staging: 'staging-originals', production: 'production-originals' };
const ENDPOINT = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;
const AT_ONCE = 8;
const MAX_FAILURES = 5;
const PROGRESS_EVERY = 500;

type Entry = VersionIds[string];
type Outcome =
    | { outcome: 'present' | 'stopped' }
    | { outcome: 'would copy' | 'copied'; contentType: string; size: number }
    | { outcome: 'failed'; detail: string };

const { idsFile, from, target, scope, go } = parsedArgs(process.argv.slice(2));
const to = BUCKETS[target];
const logFile = path.join(path.dirname(idsFile), `copy-originals-${target}.jsonl`);

const entries = await entriesInScope();
const credentials = await tokenCredentials(await openTofuToken());
const client = new AwsClient({
    accessKeyId: credentials.R2_ACCESS_KEY_ID,
    secretAccessKey: credentials.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
});

console.log(
    `${go ? 'Copying' : 'Dry run, copying nothing:'} ${String(entries.length)} originals from ${from} to ${to}; log in ${logFile}`,
);
const guard = new Guard(MAX_FAILURES);
const counts = new Map<Outcome['outcome'], number>();
let done = 0;
await inParallel(guard, entries, AT_ONCE, async ([awsPath, entry]) => {
    const outcome = await copyOne(awsPath, entry);
    counts.set(outcome.outcome, (counts.get(outcome.outcome) ?? 0) + 1);
    done += 1;
    appendFileSync(
        logFile,
        `${JSON.stringify({ at: new Date().toISOString(), go, awsPath, versionId: entry.versionId, path: entry.path, ...outcome })}\n`,
    );
    if (done % PROGRESS_EVERY === 0) {
        console.log(`  ${String(done)} of ${String(entries.length)}`);
    }
});

console.log();
for (const [outcome, count] of counts) {
    console.log(`${String(count)} ${outcome}`);
}
if (guard.halted !== null) {
    console.log(`Stopped, ${String(entries.length - done)} never started: ${guard.halted}`);
    process.exitCode = 1;
}

async function copyOne(awsPath: string, entry: Entry): Promise<Outcome> {
    const key = originalKey(entry.versionId);
    const source = awsPath.slice(1);
    const existing = await send(guard, `HEAD ${to}/${key}`, async () => client.fetch(url(to, key), { method: 'HEAD' }));
    if (existing === null) {
        return { outcome: 'stopped' };
    }
    if (existing.status === 200) {
        return { outcome: 'present' };
    }
    if (existing.status !== 404) {
        return failed(awsPath, `HEAD ${key} answered ${String(existing.status)}`);
    }

    const first = await send(guard, `read ${from}/${source}`, async () =>
        client.fetch(url(from, source), { headers: { range: `bytes=0-${String(SNIFF_LENGTH - 1)}` } }),
    );
    if (first === null) {
        return { outcome: 'stopped' };
    }
    if (first.status === 404) {
        return failed(awsPath, `not in ${from}`);
    }
    if (first.status !== 206 && first.status !== 200) {
        return failed(awsPath, `reading it answered ${String(first.status)}`);
    }
    const size = sizeOf(first);
    const sniffed = sniffMedia(new Uint8Array(await first.arrayBuffer()));
    if (sniffed === null) {
        return failed(awsPath, 'its first bytes are no format the gallery takes');
    }
    if (sniffed.mediaType !== entry.mediaType) {
        return failed(awsPath, `its row says ${entry.mediaType} and its bytes ${sniffed.mediaType}`);
    }
    if (size === null) {
        return failed(awsPath, 'reading it gave no size');
    }
    if (size !== entry.size) {
        return failed(awsPath, `${from} holds ${String(size)} bytes of it, and S3's version ${String(entry.size)}`);
    }
    // An object Super Slurper wrote in parts has an ETag of its parts, which S3's one-part MD5 cannot be compared with.
    const etag = first.headers.get('etag') ?? '';
    if (!etag.includes('-') && etag !== entry.etag) {
        return failed(awsPath, `${from} holds it with ETag ${etag}, and S3's version with ${entry.etag}`);
    }
    if (!go) {
        return { outcome: 'would copy', contentType: sniffed.contentType, size };
    }

    const copy = await send(guard, `copy ${source}`, async () =>
        client.fetch(url(to, key), {
            method: 'PUT',
            headers: {
                'x-amz-copy-source': `/${from}/${encoded(source)}`,
                'x-amz-metadata-directive': 'REPLACE',
                'content-type': sniffed.contentType,
                'x-amz-meta-path': entry.path,
                'x-amz-meta-aws-version-id': entry.awsVersionId,
            },
        }),
    );
    if (copy === null) {
        return { outcome: 'stopped' };
    }
    // A copy can answer 200 with an error in its body.
    const answer = await copy.text();
    if (!copy.ok || !answer.includes('<CopyObjectResult')) {
        return failed(awsPath, `copying it answered ${String(copy.status)} ${answer.slice(0, 200)}`);
    }

    const copied = await send(guard, `HEAD ${to}/${key}`, async () => client.fetch(url(to, key), { method: 'HEAD' }));
    if (copied === null) {
        return { outcome: 'stopped' };
    }
    const copiedSize = Number(copied.headers.get('content-length'));
    return copied.status === 200 && copiedSize === size
        ? { outcome: 'copied', contentType: sniffed.contentType, size }
        : failed(awsPath, `the copy is ${String(copiedSize)} bytes of ${String(size)}`);
}

function parsedArgs(args: string[]): {
    idsFile: string;
    from: string;
    target: 'staging' | 'production';
    scope: Scope;
    go: boolean;
} {
    const [file] = args;
    const bucket = value(args, '--from');
    if (file === undefined || file.startsWith('--') || bucket === undefined) {
        throw new Error(USAGE);
    }
    const named = parseTarget(args, ['staging', 'production']);
    if (bucket === BUCKETS[named]) {
        throw new Error(`--from names the originals bucket itself: ${bucket}`);
    }
    return { idsFile: file, from: bucket, target: named, scope: parseScope(args), go: args.includes('--go') };
}

/** The originals in scope, newest album first. */
async function entriesInScope(): Promise<[string, Entry][]> {
    const inAlbums = Object.entries(await readVersionIds(idsFile))
        .filter(([, entry]) => inScope(scope, entry.path))
        .toSorted(([, first], [, second]) => (first.path < second.path ? 1 : -1));
    if (inAlbums.length === 0) {
        throw new Error('No original in the version id file lies in the albums named');
    }
    return inAlbums;
}

async function openTofuToken(): Promise<string> {
    const token = (await devVars())['CLOUDFLARE_TERRAFORM_API_TOKEN'] ?? '';
    if (token === '') {
        throw new Error('CLOUDFLARE_TERRAFORM_API_TOKEN is not set in api/.dev.vars');
    }
    return token;
}

function failed(awsPath: string, detail: string): Outcome {
    guard.fail(`${awsPath}: ${detail}`);
    return { outcome: 'failed', detail };
}

/** The whole object's size, from a ranged read's `Content-Range`, or from its length when R2 sent it all. */
function sizeOf(response: Response): number | null {
    const range = /\/(?<total>\d+)$/v.exec(response.headers.get('content-range') ?? '')?.groups?.['total'];
    const size = Number(range ?? (response.status === 200 ? response.headers.get('content-length') : NaN));
    return Number.isInteger(size) ? size : null;
}

function url(bucket: string, key: string): string {
    return `${ENDPOINT}/${bucket}/${encoded(key)}`;
}

/** A key with each segment escaped, as a URL path and the copy-source header both want it. */
function encoded(key: string): string {
    return key.split('/').map(encodeURIComponent).join('/');
}
