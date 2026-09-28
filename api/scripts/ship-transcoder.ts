// Ships one environment's transcoder: builds the image from api/transcoder/, pushes it, and points the container
// application at it with the settings in wrangler.jsonc's `containers` block, then rolls its instances onto them. A
// Worker version carries neither, so scripts/release.sh runs this on every release. It leaves the Worker's versions
// alone, so an upload's Workflow step running at the time keeps its version.
//
// It ships only when either has changed since the commit the application's latest rollout names, which this script
// writes into the rollout's description. That is the commit the container runs, whichever the Worker runs: a release
// that fails after this step leaves the two apart. A rollout that names no commit here, such as one from a plain
// `wrangler deploy` or a dirty tree, or a PATCH whose rollout never started, ships again.
//
// Usage: node scripts/ship-transcoder.ts (staging | production) <tag>, from api/, where the tag is the release's, the
// commit it was built from.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as valibot from 'valibot';
import { unstable_readConfig } from 'wrangler';

const API_DIR = fileURLToPath(new URL('..', import.meta.url));

/** The fields of the environment's config this reads; Wrangler fills in the container's name. */
const CONFIG = valibot.object({
    account_id: valibot.string(),
    containers: valibot.tuple([
        valibot.looseObject({
            name: valibot.string(),
            instance_type: valibot.string(),
            max_instances: valibot.number(),
            rollout_active_grace_period: valibot.optional(valibot.number(), 0),
            rollout_step_percentage: valibot.optional(valibot.number(), 100),
        }),
    ]),
});
const ENVELOPE = valibot.looseObject({ success: valibot.boolean(), result: valibot.unknown() });
const APPS = valibot.array(valibot.looseObject({ id: valibot.string(), name: valibot.string() }));
const ROLLOUTS = valibot.array(
    valibot.looseObject({ created_at: valibot.string(), description: valibot.optional(valibot.string(), '') }),
);
const DIGESTS = valibot.array(valibot.string());
const TOKEN = valibot.looseObject({ token: valibot.string() });

/** Runs Wrangler in api/ and returns what it printed to stdout; its log still shows. */
function wrangler(...args: string[]): string {
    return execFileSync('npx', ['wrangler', ...args], {
        cwd: API_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
    });
}

async function containersApi(
    accountId: string,
    token: string,
    route: string,
    init: RequestInit = {},
): Promise<unknown> {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/containers${route}`, {
        ...init,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
    const text = await response.text();
    const body = valibot.safeParse(ENVELOPE, JSON.parse(text));
    if (!response.ok || !body.success || !body.output.success) {
        throw new Error(`${init.method ?? 'GET'} ${route} failed ${String(response.status)}: ${text}`);
    }
    return body.output.result;
}

/** Whether the image's sources and the config are as they were at the commit; not when the checkout lacks it. */
function unchangedSince(commit: string): boolean {
    try {
        execFileSync('git', ['diff', '--quiet', commit, '--', 'transcoder', 'wrangler.jsonc'], {
            cwd: API_DIR,
            stdio: 'ignore',
        });
        return true;
    } catch {
        return false;
    }
}

async function ship(environment: 'staging' | 'production', release: string): Promise<void> {
    // Staging is the config's top level, which an empty environment names.
    const raw: unknown = unstable_readConfig({
        config: path.join(API_DIR, 'wrangler.jsonc'),
        env: environment === 'staging' ? '' : environment,
    });
    const config = valibot.parse(CONFIG, raw);
    const [container] = config.containers;
    const accountId = config.account_id;

    // CLOUDFLARE_API_TOKEN when it is set, as in CI, and otherwise the login.
    const { token } = valibot.parse(TOKEN, JSON.parse(wrangler('auth', 'token', '--json')));
    const apps = valibot.parse(APPS, await containersApi(accountId, token, '/applications'));
    const app = apps.find(({ name }) => name === container.name);
    if (app === undefined) {
        throw new Error(`no container application ${container.name}; a plain wrangler deploy creates it`);
    }
    const rollouts = valibot.parse(ROLLOUTS, await containersApi(accountId, token, `/applications/${app.id}/rollouts`));
    const [latest] = rollouts.toSorted((first, second) => second.created_at.localeCompare(first.created_at));
    const shipped = /^release (?<commit>[0-9a-f]{7})$/v.exec(latest?.description ?? '')?.groups?.['commit'];
    if (shipped !== undefined && unchangedSince(shipped)) {
        console.log(`${container.name} unchanged since ${shipped}`);
        return;
    }

    const tag = `${container.name}:${release}`;
    // As Wrangler builds: one manifest, whose digest is the one the application records.
    execFileSync(
        'docker',
        [
            'build',
            '--platform',
            'linux/amd64',
            '--load',
            '--provenance=false',
            '--tag',
            tag,
            path.join(API_DIR, 'transcoder'),
        ],
        { stdio: 'inherit' },
    );
    // Wrangler logs Docker in to the account's registry, and pushes to it under the same name.
    execFileSync('npx', ['wrangler', 'containers', 'push', tag], { cwd: API_DIR, stdio: 'inherit' });
    // By digest, since a tag can be pushed again, as a second release from one dirty commit does.
    const repository = `registry.cloudflare.com/${accountId}/${container.name}`;
    const digests = valibot.parse(
        DIGESTS,
        JSON.parse(
            execFileSync(
                'docker',
                ['image', 'inspect', '--format', '{{json .RepoDigests}}', `${repository}:${release}`],
                {
                    encoding: 'utf8',
                },
            ),
        ),
    );
    const image = digests.find((digest) => digest.startsWith(`${repository}@`));
    if (image === undefined) {
        throw new Error(`no digest for ${tag} among ${digests.join(', ')}`);
    }
    const configuration = {
        image,
        instance_type: container.instance_type,
    };
    // The same two requests `wrangler deploy` makes.
    await containersApi(accountId, token, `/applications/${app.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
            configuration,
            max_instances: container.max_instances,
            rollout_active_grace_period: container.rollout_active_grace_period,
        }),
    });
    await containersApi(accountId, token, `/applications/${app.id}/rollouts`, {
        method: 'POST',
        body: JSON.stringify({
            description: `release ${release}`,
            strategy: 'rolling',
            kind: 'full_auto',
            step_percentage: container.rollout_step_percentage,
            target_configuration: configuration,
        }),
    });
    // `wrangler containers info` shows the previous image until the rollout is done, a minute or so from now, and an
    // instance still encoding keeps it for up to the grace period.
    console.log(`rolling ${container.name} out to ${tag}, ${image}`);
}

const [environment, release] = process.argv.slice(2);
if ((environment !== 'staging' && environment !== 'production') || release === undefined) {
    throw new Error('Usage: node scripts/ship-transcoder.ts (staging | production) <tag>');
}
await ship(environment, release);
