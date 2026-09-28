// Prints a media item's row and the objects stored for its version. The buckets are keyed by version id, so a gallery
// path finds nothing in the dashboard; this is the way from a path to its objects. Reads the deployed database and
// lists the buckets with the OpenTofu token in api/.dev.vars, which doubles as S3 credentials: an API token's id is
// an access key id, and the SHA-256 of its value the secret.
//
// Usage: node api/scripts/media.ts /2024/12-17/felix [--env production]
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as valibot from 'valibot';
import { mediaKey } from '@tacocat-gallery/shared';
import { derivedPrefix, inboxKey, originalKey } from '../src/storage/keys.ts';
import { ACCOUNT_ID, type ListedObject, listObjects } from '../src/storage/s3.ts';
import { devVars } from './dev-vars.ts';

const API_DIR = fileURLToPath(new URL('..', import.meta.url));
// Staging is wrangler.jsonc's top-level environment, so Wrangler reaches it without --env.
const TARGETS = {
    staging: {
        wranglerEnv: [],
        originals: 'staging-originals',
        uploads: 'staging-uploads',
        derived: 'staging-derived',
    },
    production: {
        wranglerEnv: ['--env', 'production'],
        originals: 'production-originals',
        uploads: 'production-uploads',
        derived: 'production-derived',
    },
};

// Wrangler's JSON output for one statement: its rows, and the columns this script reads from them.
const EXECUTED = valibot.tuple([
    valibot.looseObject({
        results: valibot.array(valibot.looseObject({ version_id: valibot.nullable(valibot.string()) })),
    }),
]);

// What the token-verify route answers with, of which the token's id is the S3 access key id.
const VERIFIED = valibot.looseObject({ result: valibot.looseObject({ id: valibot.string() }) });

const galleryPath = process.argv[2] ?? '';
const key = mediaKey(galleryPath);
const envAt = process.argv.indexOf('--env');
const environment = envAt === -1 ? 'staging' : process.argv[envAt + 1];
if (key === null || (environment !== 'staging' && environment !== 'production')) {
    throw new Error('Usage: node api/scripts/media.ts /2024/12-17/felix [--env staging|production]');
}
const target = TARGETS[environment];

const secrets = await devVars();
const token = secrets['CLOUDFLARE_TERRAFORM_API_TOKEN'] ?? '';
const [statement] = valibot.parse(
    EXECUTED,
    JSON.parse(
        await wrangler([
            'd1',
            'execute',
            'DB',
            '--remote',
            ...target.wranglerEnv,
            '--json',
            '--command',
            `SELECT * FROM item WHERE parent_path = ${quoted(key.parentPath)} AND item_name = ${quoted(key.itemName)}`,
        ]),
    ),
);
const [row] = statement.results;
if (row === undefined) {
    throw new Error(`no row at ${galleryPath}`);
}
console.log(JSON.stringify(row, null, 4));
if (row.version_id !== null) {
    await listVersion(row.version_id);
}

/**
 * The token as S3 credentials. Its id comes from the verify route, which is the one route every token may call; the
 * account's, since the token is an account token and the user route answers nothing for one.
 */
async function s3Credentials(): Promise<{ R2_ACCESS_KEY_ID: string; R2_SECRET_ACCESS_KEY: string }> {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/tokens/verify`, {
        headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
        throw new Error(`verifying the OpenTofu token failed: ${String(response.status)}`);
    }
    const { result } = valibot.parse(VERIFIED, await response.json());
    return { R2_ACCESS_KEY_ID: result.id, R2_SECRET_ACCESS_KEY: createHash('sha256').update(token).digest('hex') };
}

/**
 * Prints what each bucket holds for the version, the inbox included, where an upload the pipeline never finished
 * still sits.
 */
async function listVersion(versionId: string): Promise<void> {
    const credentials = await s3Credentials();
    const [originals, uploads, derived] = await Promise.all([
        listObjects(credentials, target.originals, originalKey(versionId)),
        listObjects(credentials, target.uploads, inboxKey(versionId)),
        listObjects(credentials, target.derived, `${derivedPrefix(versionId)}/`),
    ]);
    console.log(`\n${target.originals}:`);
    print(originals);
    console.log(`\n${target.uploads}:`);
    print(uploads);
    console.log(`\n${target.derived}:`);
    print(derived);
}

function print(objects: ListedObject[]): void {
    if (objects.length === 0) {
        console.log('  nothing');
    }
    for (const object of objects) {
        console.log(`  ${object.key}  ${String(object.size)} bytes  ${object.uploaded}`);
    }
}

/** A SQL string literal: the one thing the CLI cannot take as a parameter. */
function quoted(text: string): string {
    return `'${text.replaceAll("'", "''")}'`;
}

/** Runs Wrangler against the deployed environment and returns what it printed. */
async function wrangler(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(
            'npx',
            ['wrangler', ...args],
            {
                cwd: API_DIR,
                env: { ...process.env, CLOUDFLARE_API_TOKEN: token },
            },
            (error, stdout) => {
                if (error) {
                    reject(new Error('running wrangler failed', { cause: error }));
                } else {
                    resolve(stdout);
                }
            },
        );
    });
}
