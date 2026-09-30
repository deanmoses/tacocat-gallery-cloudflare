// Copies each AWS video's MP4 and poster frame, which MediaConvert made, from the AWS derived bucket to the target's
// derived bucket, under the version id `mint-version-ids.ts` gave the video's original (`aws-video-derivatives.ts`).
// Unlike the originals these cross the internet, S3 to the laptop to R2, since Super Slurper copies only the originals
// bucket; they are about half a gigabyte. For each file it asks whether the target already holds it, and skips one it
// does, so a rerun copies only what the last run did not; then reads its first bytes from S3 and refuses a file that is
// not the MP4 or JPEG it should be; then reads the whole of it, checking its size against S3's, writes it with the
// content type the transcoder gives its own, and checks the copy's size.
//
// It touches only the albums named with --only, or every video with --all, and copies nothing without --go: a run
// without it reads and judges the first bytes of every file in scope and says what it would copy. It stops on a
// refused credential, on a request that fails three times, and at the fifth file that goes wrong. Every file's outcome
// is a JSON line in `copy-video-derivatives-<target>.jsonl`, beside the version id file. It reads S3 as the AWS CLI's
// default profile and writes R2 with the OpenTofu token in api/.dev.vars, as `copy-originals.ts` does.
//
// Usage: node api/scripts/copy-video-derivatives.ts prod-items.json version-ids.json --to staging|production
//            (--only <album path> ... | --all) [--go]
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { AwsClient } from 'aws4fetch';
import * as valibot from 'valibot';
import { SNIFF_LENGTH, sniffMedia } from '../src/media/sniff.ts';
import { ACCOUNT_ID } from '../src/storage/s3.ts';
import { awsPath, readScan } from './aws-scan.ts';
import { type DerivativeCopy, derivativeCopies } from './aws-video-derivatives.ts';
import { devVars } from './dev-vars.ts';
import { Guard, type Scope, inParallel, inScope, parseScope, parseTarget, send } from './migration-run.ts';
import { tokenCredentials } from './r2-token.ts';
import { readVersionIds } from './version-ids-file.ts';

const USAGE =
    'Usage: node api/scripts/copy-video-derivatives.ts prod-items.json version-ids.json --to staging|production (--only <album path> ... | --all) [--go]';
const AWS_BUCKET = 'tacocat-gallery-sam-prod-derived-images';
const AWS_ENDPOINT = `https://${AWS_BUCKET}.s3.us-east-1.amazonaws.com`;
const BUCKETS = { staging: 'staging-derived', production: 'production-derived' };
const R2_ENDPOINT = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;
const AT_ONCE = 4;
const MAX_FAILURES = 5;
// What each copy's first bytes may sniff as. MediaConvert's MP4s declare `M4V ` as their major brand, with `isom`,
// `avc1` and `mp42` compatible: an H.264 MP4 all the same, written with the type the transcoder gives its own.
const SNIFFED_AS = { 'video/mp4': ['video/mp4', 'video/x-m4v'], 'image/jpeg': ['image/jpeg'] };

// What `aws configure export-credentials` prints, whose fields AWS names in PascalCase, each read by its name.
const AWS_CREDENTIALS = valibot.pipe(
    valibot.record(valibot.string(), valibot.unknown()),
    valibot.transform((raw) => ({
        accessKeyId: raw['AccessKeyId'],
        secretAccessKey: raw['SecretAccessKey'],
        sessionToken: raw['SessionToken'],
    })),
    valibot.object({
        accessKeyId: valibot.string(),
        secretAccessKey: valibot.string(),
        sessionToken: valibot.optional(valibot.string()),
    }),
);

type Outcome =
    | { outcome: 'present' | 'stopped' }
    | { outcome: 'would copy' | 'copied'; size: number }
    | { outcome: 'failed'; detail: string };

const { scanFile, idsFile, target, scope, go } = parsedArgs(process.argv.slice(2));
const to = BUCKETS[target];
const logFile = path.join(path.dirname(idsFile), `copy-video-derivatives-${target}.jsonl`);

const copies = await copiesInScope();
const r2Credentials = await tokenCredentials(await openTofuToken());
const r2 = new AwsClient({
    accessKeyId: r2Credentials.R2_ACCESS_KEY_ID,
    secretAccessKey: r2Credentials.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
});
const s3 = awsClient();

console.log(
    `${go ? 'Copying' : 'Dry run, copying nothing:'} ${String(copies.length)} video derivatives from ${AWS_BUCKET} to ${to}; log in ${logFile}`,
);
const guard = new Guard(MAX_FAILURES);
const counts = new Map<Outcome['outcome'], number>();
let done = 0;
await inParallel(guard, copies, AT_ONCE, async (copy) => {
    const outcome = await copyOne(copy);
    counts.set(outcome.outcome, (counts.get(outcome.outcome) ?? 0) + 1);
    done += 1;
    appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), go, ...copy, ...outcome })}\n`);
});

console.log();
for (const [outcome, count] of counts) {
    console.log(`${String(count)} ${outcome}`);
}
if (guard.halted !== null) {
    console.log(`Stopped, ${String(copies.length - done)} never started: ${guard.halted}`);
    process.exitCode = 1;
}

async function copyOne(copy: DerivativeCopy): Promise<Outcome> {
    const existing = await send(guard, `HEAD ${to}/${copy.target}`, async () =>
        r2.fetch(r2Url(copy.target), { method: 'HEAD' }),
    );
    if (existing === null) {
        return { outcome: 'stopped' };
    }
    if (existing.status === 200) {
        return { outcome: 'present' };
    }
    if (existing.status !== 404) {
        return failed(copy, `HEAD ${copy.target} answered ${String(existing.status)}`);
    }

    const first = await send(guard, `read ${copy.source}`, async () =>
        s3.fetch(s3Url(copy.source), { headers: { range: `bytes=0-${String(SNIFF_LENGTH - 1)}` } }),
    );
    if (first === null) {
        return { outcome: 'stopped' };
    }
    // S3 answers 403 rather than 404 for a missing key to a reader that may not list the bucket, which `send` stops on.
    if (first.status === 404) {
        return failed(copy, `not in ${AWS_BUCKET}`);
    }
    if (first.status !== 206 && first.status !== 200) {
        return failed(copy, `reading it answered ${String(first.status)}`);
    }
    const size = sizeOf(first);
    const sniffed = sniffMedia(new Uint8Array(await first.arrayBuffer()));
    if (sniffed === null || !SNIFFED_AS[copy.contentType].includes(sniffed.contentType)) {
        return failed(copy, `its bytes are ${sniffed?.contentType ?? 'no format the gallery takes'}`);
    }
    if (size === null) {
        return failed(copy, 'reading it gave no size');
    }
    if (!go) {
        return { outcome: 'would copy', size };
    }

    // The bytes copied are those sniffed and sized, or S3 answers 412.
    const whole = await send(guard, `read ${copy.source}`, async () =>
        s3.fetch(s3Url(copy.source), { headers: { 'if-match': first.headers.get('etag') ?? '' } }),
    );
    if (whole === null) {
        return { outcome: 'stopped' };
    }
    if (whole.status !== 200) {
        return failed(copy, `reading it answered ${String(whole.status)}`);
    }
    const bytes = new Uint8Array(await whole.arrayBuffer());
    if (bytes.length !== size) {
        return failed(copy, `read ${String(bytes.length)} bytes of S3's ${String(size)}`);
    }

    const put = await send(guard, `PUT ${to}/${copy.target}`, async () =>
        r2.fetch(r2Url(copy.target), { method: 'PUT', headers: { 'content-type': copy.contentType }, body: bytes }),
    );
    if (put === null) {
        return { outcome: 'stopped' };
    }
    if (!put.ok) {
        return failed(copy, `writing it answered ${String(put.status)} ${(await put.text()).slice(0, 200)}`);
    }

    const written = await send(guard, `HEAD ${to}/${copy.target}`, async () =>
        r2.fetch(r2Url(copy.target), { method: 'HEAD' }),
    );
    if (written === null) {
        return { outcome: 'stopped' };
    }
    const copiedSize = Number(written.headers.get('content-length'));
    return written.status === 200 && copiedSize === size
        ? { outcome: 'copied', size }
        : failed(copy, `the copy is ${String(copiedSize)} bytes of ${String(size)}`);
}

function parsedArgs(args: string[]): {
    scanFile: string;
    idsFile: string;
    target: 'staging' | 'production';
    scope: Scope;
    go: boolean;
} {
    const [scan, ids] = args;
    if (scan === undefined || ids === undefined || scan.startsWith('--') || ids.startsWith('--')) {
        throw new Error(USAGE);
    }
    return {
        scanFile: scan,
        idsFile: ids,
        target: parseTarget(args, ['staging', 'production']),
        scope: parseScope(args),
        go: args.includes('--go'),
    };
}

/**
 * The copies in scope, newest album first; a video whose derivatives cannot be paired stops the run before it starts.
 */
async function copiesInScope(): Promise<DerivativeCopy[]> {
    const videos = (await readScan(scanFile))
        .filter((row) => row.itemType === 'image' && row.mediaType === 'video')
        .map((row) => ({ awsPath: awsPath(row), awsVersionId: row.versionId }));
    const plan = derivativeCopies(videos, await readVersionIds(idsFile));
    if (plan.unpaired.length > 0) {
        throw new Error(`No derivatives can be paired for ${plan.unpaired.join(', ')}`);
    }
    const inAlbums = plan.copies
        .filter((copy) => inScope(scope, copy.path))
        .toSorted((first, second) => Number(first.path < second.path) - Number(first.path > second.path));
    if (inAlbums.length === 0) {
        throw new Error('No video lies in the albums named');
    }
    return inAlbums;
}

function awsClient(): AwsClient {
    const printed = execFileSync('aws', ['configure', 'export-credentials', '--format', 'process'], {
        encoding: 'utf8',
    });
    const { sessionToken, ...keys } = valibot.parse(AWS_CREDENTIALS, JSON.parse(printed));
    return new AwsClient({
        ...keys,
        ...(sessionToken !== undefined && { sessionToken }),
        service: 's3',
        region: 'us-east-1',
    });
}

async function openTofuToken(): Promise<string> {
    const token = (await devVars())['CLOUDFLARE_TERRAFORM_API_TOKEN'] ?? '';
    if (token === '') {
        throw new Error('CLOUDFLARE_TERRAFORM_API_TOKEN is not set in api/.dev.vars');
    }
    return token;
}

function failed(copy: DerivativeCopy, detail: string): Outcome {
    guard.fail(`${copy.source}: ${detail}`);
    return { outcome: 'failed', detail };
}

/** The whole object's size, from a ranged read's `Content-Range`, or from its length when S3 sent it all. */
function sizeOf(response: Response): number | null {
    const range = /\/(?<total>\d+)$/v.exec(response.headers.get('content-range') ?? '')?.groups?.['total'];
    const size = Number(range ?? (response.status === 200 ? response.headers.get('content-length') : NaN));
    return Number.isInteger(size) ? size : null;
}

function r2Url(key: string): string {
    return `${R2_ENDPOINT}/${to}/${encoded(key)}`;
}

function s3Url(key: string): string {
    return `${AWS_ENDPOINT}/${encoded(key)}`;
}

/** A key with each segment escaped, as a URL path wants it. */
function encoded(key: string): string {
    return key.split('/').map(encodeURIComponent).join('/');
}
