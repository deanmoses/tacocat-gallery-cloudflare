import { describe, expect, it, vi } from 'vitest';
import { goto } from '$app/navigation';
import { page } from 'vitest/browser';
import { render } from '$lib/test-support/render.svelte';
import { load } from './+page';
import Page from './+page.svelte';

// A search is a navigation to its own URL, which would take the test page with it.
vi.mock(import('$app/navigation'), () => ({ goto: vi.fn<typeof goto>() }));

type LoadEvent = Parameters<typeof load>[0];

/** Opens `/search` with the query string given, as the router does. */
function open(search = ''): void {
    const url = new URL(`/search${search}`, location.origin);
    const data = load({ url } as LoadEvent);
    render(Page, { data, params: {} });
}

describe('the search page', () => {
    it('waits for three letters before it will search', async () => {
        open();
        const search = page.getByRole('button', { name: 'Search' });

        await expect.element(search).toBeDisabled();

        await page.getByRole('textbox', { name: 'search' }).fill('fe');

        await expect.element(search).toBeDisabled();

        await page.getByRole('textbox', { name: 'search' }).fill('fel');

        await expect.element(search).toBeEnabled();
    });

    it('goes to the results for what the reader typed, keeping where they came from', async () => {
        open('?returnPath=%2F2001%2F06-15');
        await page.getByRole('textbox', { name: 'search' }).fill('cat & dog');

        await page.getByRole('button', { name: 'Search' }).click();

        expect(goto).toHaveBeenCalledExactlyOnceWith('/search/cat%20%26%20dog?returnPath=%2F2001%2F06-15');
    });

    it('is ready to type into, and returns to the page the reader came from', async () => {
        open('?returnPath=%2F2001%2F06-15');

        await expect.element(page.getByRole('textbox', { name: 'search' })).toHaveFocus();
        await expect.element(page.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/2001/06-15');
        expect(document.title).toBe('Search The Moses Family');
    });

    // The link is the reader's to click, so a crafted one must not lead off this site or, as a `javascript:` URL would,
    // run as script on it. A data URL stands in for that one, which lint refuses to have written down.
    it.each([
        { name: 'a URL that is no page at all', returnPath: 'data:text/html,hi' },
        { name: 'another site', returnPath: 'https://example.com/2001' },
    ])('returns home when the link that opened it names $name', async ({ returnPath }) => {
        open(`?returnPath=${encodeURIComponent(returnPath)}`);

        await expect.element(page.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/');
    });
});
