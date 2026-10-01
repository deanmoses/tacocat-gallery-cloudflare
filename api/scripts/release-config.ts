// Writes .wrangler-release.jsonc beside wrangler.jsonc: the same config with the transcoder's image named by digest in
// the account's registry instead of built from its Dockerfile, so a version upload only resolves it. Building one takes
// minutes and the build is not byte-for-byte repeatable, so every rebuild would be a new image for Cloudflare to take
// and prepare. The image is tagged with a hash of the sources it is built from, and built and pushed only when no image
// of those sources is there yet: the first release after the transcoder changes. Both environments share it.
//
// Usage: node scripts/release-config.ts, from api/. Docker has to be up only when the image has to be built.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as valibot from 'valibot';

const API_DIR = fileURLToPath(new URL('..', import.meta.url));
const SOURCES = 'transcoder';
const REPOSITORY = 'transcoder';
const DOCKERFILE = '{ "dockerfile": "./transcoder/Dockerfile" }';

const CREDENTIALS = valibot.looseObject({
    account_id: valibot.string(),
    registry_host: valibot.string(),
    username: valibot.string(),
    password: valibot.string(),
});

/** A hash of the transcoder's tracked files as they are on disk, so an uncommitted edit makes a different image. */
async function sourcesHash(): Promise<string> {
    const files = execFileSync('git', ['ls-files', SOURCES], { cwd: API_DIR, encoding: 'utf8' }).split('\n');
    const hash = createHash('sha256');
    for (const file of files.filter(Boolean).toSorted()) {
        hash.update(`${file}\0`);
        hash.update(await readFile(path.join(API_DIR, file)));
        hash.update('\0');
    }
    return hash.digest('hex').slice(0, 16);
}

/** The digest the registry holds under the tag, or undefined when it holds no such tag. */
async function digestOf(
    credentials: valibot.InferOutput<typeof CREDENTIALS>,
    tag: string,
): Promise<string | undefined> {
    const { registry_host: host, account_id: account, username, password } = credentials;
    const response = await fetch(`https://${host}/v2/${account}/${REPOSITORY}/manifests/${tag}`, {
        method: 'HEAD',
        headers: {
            authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
            accept: [
                'application/vnd.oci.image.manifest.v1+json',
                'application/vnd.oci.image.index.v1+json',
                'application/vnd.docker.distribution.manifest.v2+json',
                'application/vnd.docker.distribution.manifest.list.v2+json',
            ].join(', '),
        },
    });
    if (response.status === 404) {
        return undefined;
    }
    const digest = response.headers.get('docker-content-digest');
    if (!response.ok || digest === null) {
        throw new Error(`looking up ${REPOSITORY}:${tag} failed: ${String(response.status)}`);
    }
    return digest;
}

function build(tag: string): void {
    const local = `${REPOSITORY}:${tag}`;
    // One manifest for amd64, which is what the platform runs.
    execFileSync(
        'docker',
        ['build', '--platform', 'linux/amd64', '--load', '--provenance=false', '--tag', local, SOURCES],
        { cwd: API_DIR, stdio: ['ignore', 'inherit', 'inherit'] },
    );
    // Wrangler logs Docker in to the account's registry, and pushes to it under the same name.
    execFileSync('npx', ['wrangler', 'containers', 'push', local], {
        cwd: API_DIR,
        stdio: ['ignore', 'inherit', 'inherit'],
    });
}

const credentials = valibot.parse(
    CREDENTIALS,
    JSON.parse(
        execFileSync(
            'npx',
            ['wrangler', 'containers', 'registries', 'credentials', 'registry.cloudflare.com', '--pull', '--json'],
            { cwd: API_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
        ),
    ),
);
const tag = await sourcesHash();
let digest = await digestOf(credentials, tag);
if (digest === undefined) {
    console.error(`no ${REPOSITORY}:${tag} in the registry; building it`);
    build(tag);
    digest = await digestOf(credentials, tag);
    if (digest === undefined) {
        throw new Error(`${REPOSITORY}:${tag} is not in the registry after pushing it`);
    }
}
const image = `${credentials.registry_host}/${credentials.account_id}/${REPOSITORY}@${digest}`;

const config = await readFile(path.join(API_DIR, 'wrangler.jsonc'), 'utf8');
const parts = config.split(DOCKERFILE);
// Once at the top level and once under env.production.
if (parts.length !== 3) {
    throw new Error(
        `expected the transcoder's Dockerfile twice in wrangler.jsonc, found it ${String(parts.length - 1)}`,
    );
}
await writeFile(path.join(API_DIR, '.wrangler-release.jsonc'), parts.join(`{ "image": "${image}" }`));
console.error(`transcoder ${tag}: ${image}`);
