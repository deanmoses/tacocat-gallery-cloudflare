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
}

/**
 * Starts what `wrangler dev` runs, entirely local: the web app's build, the asset router, and the Worker with the test
 * secrets in place of .dev.vars.
 */
export async function startStack({ port, persistTo }: StackOptions): Promise<Stack> {
    await buildWebApp();
    if (persistTo !== undefined) {
        await migrate(persistTo);
    }
    return unstable_startWorker({
        config: fileURLToPath(new URL('../../wrangler.jsonc', import.meta.url)),
        // A secret binding passed here wins over the same name in .dev.vars.
        bindings: Object.fromEntries(
            Object.entries(TEST_SECRETS).map(([name, value]) => [name, { type: 'secret_text', value }]),
        ),
        dev: {
            server: { port },
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
