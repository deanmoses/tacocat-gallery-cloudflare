import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { unstable_startWorker } from 'wrangler';
import { TEST_SECRETS } from '../secrets.ts';

const REPO_DIR = fileURLToPath(new URL('../../..', import.meta.url));
const API_DIR = fileURLToPath(new URL('../..', import.meta.url));

type Stack = Awaited<ReturnType<typeof unstable_startWorker>>;

interface StackOptions {
    /** 0 picks a free port. */
    port: number;
    /**
     * A directory to keep D1 and R2 in, migrated before the Worker starts. Without one, storage lives in memory and D1
     * has no tables.
     */
    persistTo?: string;
    /** Plain-text bindings, over the vars in wrangler.jsonc, as .dev.vars would set them for `wrangler dev`. */
    vars?: Record<string, string>;
    /**
     * Whether requests keep the local origin, as `--local-upstream` has them under `npm run dev`. Otherwise wrangler
     * rewrites a same-origin request's Origin header to the custom domain's, which a passkey check refuses.
     */
    localUpstream?: boolean;
}

/**
 * Starts what `npm run dev` runs, entirely local: the web app's build, the asset router, and the Worker with the test
 * secrets in place of .dev.vars and its images made by the local Images binding. The build is a fresh one unless
 * WEB_BUILD_READY is set, which scripts/test.sh does after building once for every suite it runs.
 */
export async function startStack({ port, persistTo, vars = {}, localUpstream = false }: StackOptions): Promise<Stack> {
    if (process.env['WEB_BUILD_READY'] === undefined) {
        await buildWebApp();
    }
    if (persistTo !== undefined) {
        await migrate(persistTo);
    }
    return unstable_startWorker({
        config: fileURLToPath(new URL('../../wrangler.jsonc', import.meta.url)),
        // A secret binding passed here wins over the same name in .dev.vars.
        bindings: {
            ...Object.fromEntries(
                Object.entries(TEST_SECRETS).map(([name, value]) => [name, { type: 'secret_text', value }]),
            ),
            ...Object.fromEntries(
                Object.entries({ IMAGE_MODE: 'binding', ...vars }).map(([name, value]) => [
                    name,
                    { type: 'plain_text', value },
                ]),
            ),
        },
        dev: {
            server: { port },
            ...(localUpstream && { origin: { hostname: `localhost:${port}`, secure: false } }),
            inspector: false,
            watch: false,
            remote: false,
            persist: persistTo ?? false,
            enableContainers: false,
        },
    });
}

async function buildWebApp(): Promise<void> {
    await npm(['run', '--silent', 'build', '--workspace', 'web'], REPO_DIR, 'building the web app failed');
}

/**
 * Puts a file into the local R2 storage under `persistTo`, as `wrangler r2 object put --local` does, so a Worker started
 * on that storage finds it. `objectPath` is `<bucket>/<key>`, the bucket by its name in wrangler.jsonc.
 */
export async function putLocalObject(
    persistTo: string,
    objectPath: string,
    file: string,
    contentType: string,
): Promise<void> {
    const put = ['r2', 'object', 'put', objectPath, '--file', file, '--content-type', contentType, '--local'];
    await npm(
        ['exec', '--no', '--', 'wrangler', ...put, '--persist-to', persistTo],
        API_DIR,
        `putting ${objectPath} into local R2 failed`,
    );
}

/**
 * Runs SQL on the local D1 database under `persistTo`, as `wrangler d1 execute --local` does, for rows no route writes.
 * A Worker already running on that storage sees them.
 */
export async function executeLocalSql(persistTo: string, sql: string): Promise<void> {
    const execute = ['d1', 'execute', 'DB', '--local', '--persist-to', persistTo, '--command', sql];
    await npm(['exec', '--no', '--', 'wrangler', ...execute], API_DIR, 'running SQL on the local database failed');
}

async function migrate(persistTo: string): Promise<void> {
    const apply = ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persistTo];
    await npm(['exec', '--no', '--', 'wrangler', ...apply], API_DIR, 'migrating the local database failed');
}

async function npm(args: string[], cwd: string, failure: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        execFile('npm', args, { cwd }, (error) => {
            if (error) {
                reject(new Error(failure, { cause: error }));
            } else {
                resolve();
            }
        });
    });
}
