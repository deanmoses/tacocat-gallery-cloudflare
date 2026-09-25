// Prints a media item's row and the objects stored for its version. The buckets are keyed by version id, so a gallery
// path finds nothing in the dashboard; this is the way from a path to its objects. Reads the deployed database with
// the account token and lists the buckets through the S3 API, both with what api/.dev.vars holds.
//
// Usage: node api/scripts/media.ts /2024/12-17/felix.jpg [--env production]
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as valibot from 'valibot';
import { derivedPrefix, originalKey } from '../src/storage/keys.ts';
import { type ListedObject, listObjects } from '../src/storage/s3.ts';
import { devVars } from './dev-vars.ts';

const API_DIR = fileURLToPath(new URL('..', import.meta.url));
// Staging is wrangler.jsonc's top-level environment, so Wrangler reaches it without --env.
const TARGETS = {
    staging: { wranglerEnv: [], media: 'tacocat-staging-media', derived: 'tacocat-staging-derived' },
    production: {
        wranglerEnv: ['--env', 'production'],
        media: 'tacocat-proto-media',
        derived: 'tacocat-proto-derived',
    },
};

// Wrangler's JSON output for one statement: its rows, and the columns this script reads from them.
const EXECUTED = valibot.tuple([
    valibot.looseObject({
        results: valibot.array(valibot.looseObject({ version_id: valibot.nullable(valibot.string()) })),
    }),
]);

const galleryPath = process.argv[2] ?? '';
// A media path: a file with one extension in a day album. The parser in shared/ is out of a script's reach, since Node
// resolves that package's imports differently from the Worker's bundler, so the shape is spelled out here.
const key = /^(?<parentPath>\/\d{4}\/\d{2}-\d{2}\/)(?<itemName>[^.\/]+\.[^.\/]+)$/v.exec(galleryPath)?.groups;
const envAt = process.argv.indexOf('--env');
const environment = envAt === -1 ? 'staging' : process.argv[envAt + 1];
if (key === undefined || (environment !== 'staging' && environment !== 'production')) {
    throw new Error('Usage: node api/scripts/media.ts /2024/12-17/felix.jpg [--env staging|production]');
}
const target = TARGETS[environment];

const secrets = await devVars();
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
            `SELECT * FROM item WHERE parent_path = ${quoted(key['parentPath'] ?? '')} AND item_name = ${quoted(key['itemName'] ?? '')}`,
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

/** Prints what each bucket holds for the version. */
async function listVersion(versionId: string): Promise<void> {
    const credentials = {
        R2_ACCESS_KEY_ID: secrets['R2_ACCESS_KEY_ID'] ?? '',
        R2_SECRET_ACCESS_KEY: secrets['R2_SECRET_ACCESS_KEY'] ?? '',
    };
    const [originals, derived] = await Promise.all([
        listObjects(credentials, target.media, originalKey(versionId)),
        listObjects(credentials, target.derived, `${derivedPrefix(versionId)}/`),
    ]);
    console.log(`\n${target.media}:`);
    print(originals);
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
                env: { ...process.env, CLOUDFLARE_API_TOKEN: secrets['CLOUDFLARE_TERRAFORM_API_TOKEN'] ?? '' },
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
