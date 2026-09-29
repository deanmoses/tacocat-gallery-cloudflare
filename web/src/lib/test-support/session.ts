import { expect, vi } from 'vitest';
import { sessionStore } from '$lib/stores/SessionStore.svelte';
import { fakeServer, jsonResponse } from './http';

/**
 * The server, and the session store saying who is logged in, as the root layout has it on any page. The store is asked
 * only when it says otherwise, so the test waits out every answer it asks for: a guest's lands only after an IndexedDB
 * read, late enough to overwrite what the next test set up.
 */
export async function signedIn(admin: string | null): Promise<ReturnType<typeof fakeServer>> {
    const server = fakeServer();
    server.get('/api/auth/status', jsonResponse({ admin }));
    const wanted = admin !== null;
    if (sessionStore.isCheckingAuth || sessionStore.isAdmin !== wanted) {
        sessionStore.fetchUserStatus();
        await vi.waitFor(() => {
            expect(!sessionStore.isCheckingAuth && sessionStore.isAdmin === wanted).toBe(true);
        });
    }
    return server;
}
