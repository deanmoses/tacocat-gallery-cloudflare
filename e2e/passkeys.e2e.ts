import { type Page, expect, test } from '@playwright/test';
import { mintInvite, revealAdminControls } from './support.ts';

const DAY_PATH = '/2001/06-15';

/**
 * Gives the page a passkey device, Chromium's virtual authenticator, which answers the browser's prompt at once as
 * Face ID or Touch ID would once the admin had.
 */
async function addAuthenticator(page: Page): Promise<void> {
    const devtools = await page.context().newCDPSession(page);
    await devtools.send('WebAuthn.enable');
    await devtools.send('WebAuthn.addVirtualAuthenticator', {
        options: {
            protocol: 'ctap2',
            transport: 'internal',
            hasResidentKey: true,
            hasUserVerification: true,
            isUserVerified: true,
            automaticPresenceSimulation: true,
        },
    });
}

test.describe('an admin with an invite', () => {
    test('creates a passkey, logs out, and logs back in where they were', async ({ page }) => {
        const token = await mintInvite('moses');
        await addAuthenticator(page);

        await test.step('the invite page offers a passkey for the invited admin', async () => {
            await page.goto(`/invite/${token}`);

            await expect(page.getByText('Create passkey to login as moses.')).toBeVisible();
        });

        await test.step('creating it logs them in, and home shows them as an admin', async () => {
            await page.getByRole('button', { name: 'Create passkey' }).click();

            await expect(page.getByText("Passkey created. You're logged in as moses.")).toBeVisible();

            await page.getByRole('link', { name: 'Go to the home page' }).click();

            await expect(page).toHaveURL('/');

            await page.goto(DAY_PATH);
            await revealAdminControls(page);

            await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
        });

        await test.step('the invite is used up', async () => {
            await page.goto(`/invite/${token}`);

            await expect(page.getByRole('alert')).toHaveText('This invite link is invalid, used or expired.');
            await expect(page.getByRole('button', { name: 'Create passkey' })).toHaveCount(0);
        });

        await test.step('logging out returns them home as a guest', async () => {
            await page.goto('/login');
            await page.getByRole('button', { name: 'Logout' }).click();

            await expect(page).toHaveURL('/');

            const status = await page.request.get('/api/auth/status');

            await expect(status.json()).resolves.toStrictEqual({ admin: null });
        });

        await test.step('logging in from a day album returns them to it as an admin', async () => {
            await page.goto(DAY_PATH);
            await revealAdminControls(page);
            await page.getByRole('button', { name: 'Login' }).click();

            await expect(page).toHaveURL(`/login?returnPath=${encodeURIComponent(DAY_PATH)}`);

            await page.getByRole('button', { name: 'Login with passkey' }).click();

            await expect(page).toHaveURL(DAY_PATH);

            await revealAdminControls(page);

            await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
        });
    });
});
