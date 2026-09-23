import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';
import { unstable_startWorker } from 'wrangler';

declare module 'vitest' {
    export interface ProvidedContext {
        stackOrigin: string;
    }
}

/**
 * Starts what `wrangler dev` runs, entirely local: the web app's build, the asset router, and the Worker with
 * throwaway bindings. Once for the whole run, since the build alone takes seconds.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
    await buildWebApp();
    const stack = await unstable_startWorker({
        config: fileURLToPath(new URL('../../wrangler.jsonc', import.meta.url)),
        dev: {
            server: { port: 0 },
            inspector: false,
            watch: false,
            remote: false,
            persist: false,
            enableContainers: false,
        },
    });
    const url = await stack.url;
    project.provide('stackOrigin', url.origin);
    return async () => {
        await stack.dispose();
    };
}

async function buildWebApp(): Promise<void> {
    const cwd = fileURLToPath(new URL('../../..', import.meta.url));
    await new Promise<void>((resolve, reject) => {
        execFile('npm', ['run', '--silent', 'build', '--workspace', 'web'], { cwd }, (error) => {
            if (error) {
                reject(new Error('building the web app failed', { cause: error }));
            } else {
                resolve();
            }
        });
    });
}
