import { describe, expect, it, vi } from 'vitest';
import { toast } from '@zerodevx/svelte-toast';
import { AUTH_STATUS_HEADER, type AuthStatus } from '@tacocat-gallery/shared';
import { sessionStore } from '$lib/stores/SessionStore.svelte';
import { signedIn } from '$lib/test-support/session';
import { noteAuthStatus } from './session';

function answered(status: AuthStatus): Response {
    return new Response(null, { headers: { [AUTH_STATUS_HEADER]: status } });
}

describe(noteAuthStatus, () => {
    it('makes an admin whose cookie the Worker refused a guest, and tells them to log in again', async () => {
        await signedIn('moses');
        const pushed = vi.spyOn(toast, 'push');

        noteAuthStatus(answered('invalid'));

        expect(sessionStore.isAdmin).toBe(false);
        expect(sessionStore.hasBeenLoggedIn).toBe(true);

        await vi.waitFor(() => {
            expect(pushed).toHaveBeenCalledWith('Your session has expired. Please log in again.');
        });
    });

    it('leaves an admin whose cookie was accepted alone', async () => {
        await signedIn('moses');

        noteAuthStatus(answered('valid'));

        expect(sessionStore.isAdmin).toBe(true);
    });

    it('says nothing to a guest, whose stale cookie is refused on every request', async () => {
        await signedIn(null);
        const pushed = vi.spyOn(toast, 'push');

        noteAuthStatus(answered('invalid'));
        noteAuthStatus(answered('none'));
        // A toast would arrive after its module loads; sound only for asserting that none does.
        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });

        expect(sessionStore.isAdmin).toBe(false);
        expect(pushed).not.toHaveBeenCalled();
    });
});
