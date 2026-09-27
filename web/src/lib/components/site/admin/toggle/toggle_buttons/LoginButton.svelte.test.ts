import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { goto } from '$app/navigation';
import type * as appState from '$app/state';
import { render } from '$lib/test-support/render.svelte';
import LoginButton from './LoginButton.svelte';

vi.mock(import('$app/navigation'), () => ({ goto: vi.fn<typeof goto>() }));
vi.mock(import('$app/state'), () => ({
    page: { url: new URL('https://pix.example/search/tacos?oldest=2001&newest=2005') } as typeof appState.page,
}));

describe('the login button', () => {
    it('sends the admin to log in, to come back to this page with its query string', async () => {
        render(LoginButton, {});
        await page.getByRole('button', { name: 'Login' }).click();

        expect(goto).toHaveBeenCalledWith(
            `/login?returnPath=${encodeURIComponent('/search/tacos?oldest=2001&newest=2005')}`,
        );
    });
});
