import type { TestProject } from 'vitest/node';
import { startStack } from './start.ts';

declare module 'vitest' {
    export interface ProvidedContext {
        stackOrigin: string;
    }
}

/** Starts the local stack once for the whole run, since the build alone takes seconds. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
    const stack = await startStack({ port: 0 });
    const url = await stack.url;
    project.provide('stackOrigin', url.origin);
    return async () => {
        await stack.dispose();
    };
}
