import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { type Mock, describe, expect, inject, it, vi } from 'vitest';

/**
 * Browsers that visited the AWS app on this hostname hold its service worker, and check for an update at its URL. Only
 * a script there replaces it: the app's fallback page fails the update on its content type, and the old worker and its
 * caches stay for good. Nothing on this site registers the script.
 */
describe('/service-worker.js', () => {
    it('is a script, as a registered worker asks for its update', async () => {
        const response = await fetch(new URL('/service-worker.js', inject('stackOrigin')), {
            headers: { 'service-worker': 'script', 'sec-fetch-dest': 'serviceworker', 'sec-fetch-mode': 'same-origin' },
        });
        await response.body?.cancel();

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toMatch(/^(?:application|text)\/javascript\b/v);
    });

    it('takes over at once, then deletes every cache and unregisters itself', async () => {
        const worker = await loadWorker(async () => ['assets-v1', 'images']);

        await worker.dispatch('install');

        expect(worker.scope.skipWaiting).toHaveBeenCalledExactlyOnceWith();
        expect(worker.scope.registration.unregister).not.toHaveBeenCalled();

        await worker.dispatch('activate');

        expect(worker.scope.caches.delete.mock.calls).toStrictEqual([['assets-v1'], ['images']]);
        expect(worker.scope.registration.unregister).toHaveBeenCalledExactlyOnceWith();
    });

    it('unregisters even when the caches cannot be read', async () => {
        const worker = await loadWorker(async () => {
            throw new Error('caches unavailable');
        });

        await expect(worker.dispatch('activate')).rejects.toThrow('caches unavailable');
        expect(worker.scope.registration.unregister).toHaveBeenCalledExactlyOnceWith();
    });
});

/** Runs the script with stand-ins for a worker's scope as its global, where `keys` answers `caches.keys()`. */
async function loadWorker(keys: () => Promise<string[]>): Promise<Worker> {
    const script = await readFile(new URL('../../../web/static/service-worker.js', import.meta.url), 'utf8');
    const listeners = new Map<string, Listener>();
    const scope = {
        addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
        skipWaiting: vi.fn<() => Promise<void>>(async () => {
            await Promise.resolve();
        }),
        registration: { unregister: vi.fn<() => Promise<boolean>>(async () => true) },
        caches: { keys, delete: vi.fn<(name: string) => Promise<boolean>>(async () => true) },
    };
    runInNewContext(script, scope);
    return { scope, dispatch: async (type: string) => dispatch(listeners, type) };
}

interface Worker {
    scope: {
        skipWaiting: Mock<() => Promise<void>>;
        registration: { unregister: Mock<() => Promise<boolean>> };
        caches: { delete: Mock<(name: string) => Promise<boolean>> };
    };
    dispatch: (type: string) => Promise<void>;
}

type Listener = (event: { waitUntil: (work: Promise<unknown>) => void }) => void;

/** Fires an event as the browser does, and waits for what the listener handed `waitUntil`. */
async function dispatch(listeners: Map<string, Listener>, type: string): Promise<void> {
    const work: Promise<unknown>[] = [];
    listeners.get(type)?.({
        waitUntil: (promise) => {
            work.push(promise);
        },
    });
    await Promise.all(work);
}
