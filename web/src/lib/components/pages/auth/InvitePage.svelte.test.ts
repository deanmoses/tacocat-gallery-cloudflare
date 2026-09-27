import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { type startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { fakeServer, jsonResponse } from '$lib/test-support/http';
import { render } from '$lib/test-support/render.svelte';
import InvitePage from './InvitePage.svelte';

// The browser's passkey prompt is the one thing a test cannot answer, so the library that opens it stands in for it.
vi.mock(import('@simplewebauthn/browser'), () => ({
    startRegistration: vi.fn<typeof startRegistration>(),
    startAuthentication: vi.fn<typeof startAuthentication>(),
}));

const TOKEN = 'invite-token';
const USED = 'This invite link is invalid, used or expired.';

function liveInvite(): ReturnType<typeof fakeServer> {
    const server = fakeServer();
    server.post('/api/auth/invite', jsonResponse({ username: 'moses' }));
    server.post('/api/auth/register/options', jsonResponse({ challenge: 'c', rp: {}, user: {}, pubKeyCredParams: [] }));
    server.post('/api/auth/register/verify', jsonResponse({ admin: 'moses' }));
    return server;
}

describe('the invite page', () => {
    it('says a used invite is used, and offers no passkey', async () => {
        const server = fakeServer();
        server.post('/api/auth/invite', jsonResponse({ errorMessage: USED }, 404));
        render(InvitePage, { token: TOKEN });

        await expect.element(page.getByRole('alert')).toHaveTextContent(USED);
        await expect.element(page.getByRole('link', { name: 'log in with it' })).toHaveAttribute('href', '/login');
        expect(page.getByRole('button', { name: 'Create passkey' }).query()).toBeNull();
        expect(server.calls).toStrictEqual([{ method: 'POST', pathname: '/api/auth/invite', body: { token: TOKEN } }]);
    });

    it('names the admin a live invite is for', async () => {
        liveInvite();
        render(InvitePage, { token: TOKEN });

        await expect.element(page.getByText(/Create passkey to login as moses\./v)).toBeVisible();
        await expect.element(page.getByRole('button', { name: 'Create passkey' })).toBeEnabled();
    });

    it('links to the home page once the passkey is made', async () => {
        const server = liveInvite();
        vi.mocked(startRegistration).mockResolvedValue({ id: 'credential' } as never);
        render(InvitePage, { token: TOKEN });
        await page.getByRole('button', { name: 'Create passkey' }).click();

        await expect.element(page.getByText("Passkey created. You're logged in as moses.")).toBeVisible();
        await expect.element(page.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/');
        await expect
            .element(page.getByRole('link', { name: 'Go to the home page' }))
            .toHaveAttribute('data-sveltekit-reload');
        expect(server.calls).toContainEqual({
            method: 'POST',
            pathname: '/api/auth/register/verify',
            body: { token: TOKEN, response: { id: 'credential' } },
        });
    });

    it('says so when the passkey prompt is dismissed, and lets them try again', async () => {
        liveInvite();
        vi.mocked(startRegistration).mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
        render(InvitePage, { token: TOKEN });
        await page.getByRole('button', { name: 'Create passkey' }).click();

        await expect
            .element(page.getByRole('alert'))
            .toHaveTextContent('The passkey prompt was closed or timed out. Try again.');
        await expect.element(page.getByRole('button', { name: 'Create passkey' })).toBeEnabled();
    });

    it('links home from its header', async () => {
        liveInvite();
        render(InvitePage, { token: TOKEN });

        await expect.element(page.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    });
});
