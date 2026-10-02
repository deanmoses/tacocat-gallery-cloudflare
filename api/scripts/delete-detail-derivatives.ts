// Deletes the JPEG derivatives the Images binding wrote with the original's EXIF, XMP and IPTC still in them, which
// `detail-derivatives.ts` picks out by key, so that each is made again, stripped, the next time it is asked for. Run
// after the Worker that strips them is serving, the dry run included, or it makes them again as they were or misses
// those made between the listing and the deploy; and purge the zone's cache after it, since each colo's Cache API
// holds its own copy for a year. A browser that cached one keeps it as long, being told it is immutable, until its
// site data is cleared.
//
// It deletes nothing without --go. A run without it lists the whole derived bucket, says how many objects of each
// name it holds and how many it would delete, and writes their keys, one a line, to
// `detail-derivatives-<target>.txt` in the current directory. A run with --go deletes the keys in the file named,
// which is that list once read through, refusing the whole file if any key in it is not one `detail-derivatives.ts`
// takes. It stops on a refused credential, on a request that fails three times, and at the fifth key that goes wrong.
// Every key's outcome is a JSON line in `delete-detail-derivatives-<target>.jsonl`. It reaches R2 with the OpenTofu
// token in api/.dev.vars.
//
// Usage: node api/scripts/delete-detail-derivatives.ts --to staging|production [--go <key list>]
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { AwsClient } from 'aws4fetch';
import { ACCOUNT_ID } from '../src/storage/s3.ts';
import { isMetadataJpeg } from './detail-derivatives.ts';
import { devVars } from './dev-vars.ts';
import { Guard, inParallel, parseTarget, send, value } from './migration-run.ts';
import { tokenCredentials } from './r2-token.ts';

const USAGE = 'Usage: node api/scripts/delete-detail-derivatives.ts --to staging|production [--go <key list>]';
const BUCKETS = { staging: 'staging-derived', production: 'production-derived' };
const R2_ENDPOINT = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;
const AT_ONCE = 8;
const MAX_FAILURES = 5;

const { target, keyList } = parsedArgs(process.argv.slice(2));
const bucket = BUCKETS[target];

const credentials = await tokenCredentials(await openTofuToken());
const r2 = new AwsClient({
    accessKeyId: credentials.R2_ACCESS_KEY_ID,
    secretAccessKey: credentials.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
});
const guard = new Guard(MAX_FAILURES);

if (keyList === null) {
    await listOnly();
} else {
    await deleteListed(keyList);
}
if (guard.halted !== null) {
    process.exitCode = 1;
}

/** The target, and the key list to delete, which is null for a dry run. */
function parsedArgs(args: string[]): { target: 'staging' | 'production'; keyList: string | null } {
    const to = parseTarget(args, ['staging', 'production']);
    if (!args.includes('--go')) {
        return { target: to, keyList: null };
    }
    const file = value(args, '--go');
    if (file === undefined || file.startsWith('--')) {
        throw new Error(USAGE);
    }
    return { target: to, keyList: file };
}

async function listOnly(): Promise<void> {
    console.log(`Dry run, deleting nothing: listing ${bucket}`);
    const keys = await listAll('derived/');
    if (keys === null) {
        return;
    }
    const doomed = keys.filter(isMetadataJpeg);
    const byName = new Map<string, { kept: number; deleted: number }>();
    for (const key of keys) {
        const name = shapeOf(key.split('/').slice(2).join('/'));
        const entry = byName.get(name) ?? { kept: 0, deleted: 0 };
        if (isMetadataJpeg(key)) {
            entry.deleted += 1;
        } else {
            entry.kept += 1;
        }
        byName.set(name, entry);
    }
    const listFile = `detail-derivatives-${target}.txt`;
    writeFileSync(listFile, doomed.map((key) => `${key}\n`).join(''));

    console.log(`${String(keys.length)} objects under derived/, by name: kept, then deleted`);
    for (const [name, { kept, deleted }] of [...byName].toSorted(
        ([, first], [, second]) => second.kept + second.deleted - first.kept - first.deleted,
    )) {
        console.log(`  ${String(kept).padStart(7)} ${String(deleted).padStart(7)}  ${name}`);
    }
    console.log(`Would delete ${String(doomed.length)}; their keys are in ${listFile}.`);
    console.log(`Read it, then: node api/scripts/delete-detail-derivatives.ts --to ${target} --go ${listFile}`);
}

async function deleteListed(file: string): Promise<void> {
    const keys = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line !== '');
    const refused = keys.filter((key) => !isMetadataJpeg(key));
    if (refused.length > 0) {
        throw new Error(
            `${file} holds ${String(refused.length)} keys that are not metadata JPEGs, ${refused[0] ?? ''} first`,
        );
    }
    const logFile = `delete-detail-derivatives-${target}.jsonl`;
    console.log(`Deleting ${String(keys.length)} objects from ${bucket}; log in ${logFile}`);
    let deleted = 0;
    await inParallel(guard, keys, AT_ONCE, async (key) => {
        const response = await send(guard, `DELETE ${bucket}/${key}`, async () =>
            r2.fetch(r2Url(key), { method: 'DELETE' }),
        );
        if (response === null) {
            return;
        }
        // R2 answers 204 for a key it held and for one it did not, so a rerun deletes nothing twice.
        const outcome = response.status === 204 ? 'deleted' : 'failed';
        if (outcome === 'deleted') {
            deleted += 1;
        } else {
            guard.fail(`${key}: DELETE answered ${String(response.status)} ${(await response.text()).slice(0, 200)}`);
        }
        appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), key, outcome })}\n`);
    });
    console.log(`${String(deleted)} deleted of ${String(keys.length)}`);
    if (guard.halted !== null) {
        console.log(`Stopped: ${guard.halted}`);
    }
}

/** Every key under the prefix, a thousand a request, or null once the run has stopped. */
async function listAll(prefix: string): Promise<string[] | null> {
    const keys: string[] = [];
    let token: string | null = null;
    do {
        const url = new URL(`${R2_ENDPOINT}/${bucket}`);
        url.searchParams.set('list-type', '2');
        url.searchParams.set('prefix', prefix);
        if (token !== null) {
            url.searchParams.set('continuation-token', token);
        }
        const response = await send(guard, `list ${bucket}/${prefix}`, async () => r2.fetch(url.href));
        if (response === null) {
            return null;
        }
        const xml = await response.text();
        if (!response.ok) {
            guard.halt(`listing ${bucket} answered ${String(response.status)} ${xml.slice(0, 200)}`);
            return null;
        }
        keys.push(
            ...[...xml.matchAll(/<Key>(?<key>.*?)<\/Key>/gv)].map(({ groups }) => unescaped(groups?.['key'] ?? '')),
        );
        token = xml.includes('<IsTruncated>true</IsTruncated>')
            ? unescaped(
                  /<NextContinuationToken>(?<token>.*?)<\/NextContinuationToken>/v.exec(xml)?.groups?.['token'] ?? '',
              )
            : null;
        process.stdout.write(`\r${String(keys.length)} listed`);
    } while (token !== null);
    process.stdout.write('\n');
    return keys;
}

/** A derivative's name with its numbers written as `N`, so a listing counts `1024` and `x612` among their kind. */
function shapeOf(name: string): string {
    return name.replaceAll(/\d+(?:\.\d+)?/gv, 'N');
}

/** The five entities an S3 listing escapes in a key. */
function unescaped(text: string): string {
    return text
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&apos;', "'")
        .replaceAll('&amp;', '&');
}

async function openTofuToken(): Promise<string> {
    const token = (await devVars())['CLOUDFLARE_TERRAFORM_API_TOKEN'] ?? '';
    if (token === '') {
        throw new Error('CLOUDFLARE_TERRAFORM_API_TOKEN is not set in api/.dev.vars');
    }
    return token;
}

/** A key with each segment escaped, as a URL path wants it. */
function r2Url(key: string): string {
    return `${R2_ENDPOINT}/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
}
