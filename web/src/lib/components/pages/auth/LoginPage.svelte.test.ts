import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { startAuthentication, type startRegistration } from '@simplewebauthn/browser';
import { loadDocument } from '$lib/utils/documentLoad';
import { jsonResponse } from '$lib/test-support/http';
import { signedIn } from '$lib/test-support/session';
import { render } from '$lib/test-support/render.svelte';
import LoginPage from './LoginPage.svelte';

// A document load would replace the test page itself.
vi.mock(import('$lib/utils/documentLoad'), () => ({ loadDocument: vi.fn<typeof loadDocument>() }));
// The browser's passkey prompt is the one thing a test cannot answer, so the library that opens it stands in for it.
vi.mock(import('@simplewebauthn/browser'), () => ({
    startAuthentication: vi.fn<typeof startAuthentication>(),
    startRegistration: vi.fn<typeof startRegistration>(),
}));

const RETURN_PATH = '/search/tacos?oldest=2001';

describe('the login page', () => {
    it('logs a guest in with a passkey, then loads the page they came from afresh', async () => {
        const server = await signedIn(null);
        server.post('/api/auth/login/options', jsonResponse({ challenge: 'c' }));
        server.post('/api/auth/login/verify', jsonResponse({ admin: 'moses' }));
        vi.mocked(startAuthentication).mockResolvedValue({ id: 'credential' } as never);
        render(LoginPage, { returnPath: RETURN_PATH });
        await page.getByRole('button', { name: 'Login with passkey' }).click();

        await vi.waitFor(() => {
            expect(loadDocument).toHaveBeenCalledWith(RETURN_PATH);
        });

        expect(server.calls).toContainEqual({
            method: 'POST',
            pathname: '/api/auth/login/verify',
            body: { id: 'credential' },
        });
    });

    it("says why a login failed, and doesn't leave the page", async () => {
        const server = await signedIn(null);
        server.post('/api/auth/login/options', jsonResponse({ challenge: 'c' }));
        server.post(
            '/api/auth/login/verify',
            jsonResponse({ errorMessage: 'This passkey is not registered here.' }, 401),
        );
        vi.mocked(startAuthentication).mockResolvedValue({ id: 'credential' } as never);
        render(LoginPage, { returnPath: RETURN_PATH });
        await page.getByRole('button', { name: 'Login with passkey' }).click();

        await expect.element(page.getByRole('alert')).toHaveTextContent('This passkey is not registered here.');
        await expect.element(page.getByRole('button', { name: 'Login with passkey' })).toBeEnabled();
        expect(loadDocument).not.toHaveBeenCalled();
    });

    it('logs an admin out, then loads the page they came from afresh', async () => {
        const server = await signedIn('moses');
        server.post('/api/auth/logout', jsonResponse({ admin: null }));
        render(LoginPage, { returnPath: RETURN_PATH });

        await expect.element(page.getByText("You're logged in")).toBeVisible();

        await page.getByRole('button', { name: 'Logout' }).click();

        await vi.waitFor(() => {
            expect(loadDocument).toHaveBeenCalledWith(RETURN_PATH);
        });

        expect(server.calls).toContainEqual({ method: 'POST', pathname: '/api/auth/logout', body: undefined });
    });

    it('links home with a whole-page load', async () => {
        await signedIn(null);
        render(LoginPage, { returnPath: RETURN_PATH });

        await expect.element(page.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
        await expect.element(page.getByRole('link', { name: 'Home' })).toHaveAttribute('data-sveltekit-reload');
    });
});
