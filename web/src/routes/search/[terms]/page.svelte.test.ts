import { beforeEach, describe, expect, it, vi } from 'vitest';
import { goto } from '$app/navigation';
import { page } from 'vitest/browser';
import { fakeServer, jsonResponse, serverError } from '$lib/test-support/http';
import { imageRecord, mediaPath } from '$lib/test-support/records';
import { type Rendered, render } from '$lib/test-support/render.svelte';
import { searchStore } from '$lib/stores/SearchStore.svelte';
import type { GalleryRecord } from '$lib/models/impl/server';
import { load } from './+page';
import Page from './+page.svelte';

// Searching again is a navigation to the new search's own URL, which would take the test page with it.
vi.mock(import('$app/navigation'), () => ({ goto: vi.fn<typeof goto>() }));

/**
 * The search results route as the router runs it: `load` starts the search, and the page shows whatever the store
 * holds for it. The API is answered by a fake server.
 */
const SEARCH = '/api/search/felix';

type LoadEvent = Parameters<typeof load>[0];
type Props = Parameters<typeof Page>[1];

function photos(from: number, count: number): GalleryRecord[] {
    return Array.from({ length: count }, (_unused, index) => {
        const name = `photo_${from + index}`;
        return imageRecord({ path: mediaPath(name), itemName: name, title: `Photo ${from + index}` });
    });
}

function found(items: GalleryRecord[], total = items.length): Response {
    return jsonResponse({ total, items });
}

/** What the router hands the page for `/search/felix` with the query string given. */
function visit(search = ''): Props {
    const url = new URL(`/search/felix${search}`, location.origin);
    const params = { terms: 'felix' };
    return { data: load({ params, url } as LoadEvent), params };
}

/** Opens `/search/felix` with the query string given. */
function open(search = ''): Rendered<Props> {
    return render(Page, visit(search));
}

/** Each request the page made of the server, as where it asked the results to start from. */
function startsAskedFor(server: ReturnType<typeof fakeServer>): (string | null)[] {
    return server.rawCalls.map((call) => call.url.searchParams.get('startAt'));
}

/** Two frames, by which an IntersectionObserver has reported anything the last layout put in view. */
async function intersectionsReported(): Promise<void> {
    for (let frame = 0; frame < 2; frame += 1) {
        await new Promise((resolve) => {
            requestAnimationFrame(resolve);
        });
    }
}

describe('the search results page', () => {
    beforeEach(() => {
        searchStore.clear();
    });

    it('links to each match, under how many there are in all', async () => {
        const server = fakeServer();
        server.get(
            SEARCH,
            found([
                imageRecord({ path: mediaPath('felix'), itemName: 'felix', title: 'Felix' }),
                imageRecord({ path: mediaPath('cake'), itemName: 'cake', title: 'Cake' }),
            ]),
        );

        open();

        await expect
            .element(page.getByRole('link', { name: 'Felix', exact: true }))
            .toHaveAttribute('href', mediaPath('felix'));
        await expect
            .element(page.getByRole('link', { name: 'Cake', exact: true }))
            .toHaveAttribute('href', mediaPath('cake'));
        await expect.element(page.getByText('(2 results)')).toBeVisible();
        expect(document.title).toBe('Search for felix');
    });

    it('says so when nothing matches', async () => {
        const server = fakeServer();
        server.get(SEARCH, found([]));

        open();

        await expect.element(page.getByText('No results')).toBeVisible();
    });

    it('gives the reason the server refused the search', async () => {
        const server = fakeServer();
        server.get(SEARCH, jsonResponse({ errorMessage: 'A search needs a word to look for' }, 400));

        open();

        await expect.element(page.getByText('A search needs a word to look for')).toBeVisible();
    });

    it('says there was an error when the search fails without a reason', async () => {
        const server = fakeServer();
        server.get(SEARCH, serverError());

        open();

        await expect.element(page.getByText('There was an error searching')).toBeVisible();
    });

    it('searches again on coming back to a search that failed', async () => {
        const server = fakeServer();
        server.get(
            SEARCH,
            serverError(),
            found([imageRecord({ path: mediaPath('felix'), itemName: 'felix', title: 'Felix' })]),
        );
        const shown = open();

        await expect.element(page.getByText('There was an error searching')).toBeVisible();

        shown.rerender(visit());

        await expect.element(page.getByRole('link', { name: 'Felix', exact: true })).toBeVisible();
    });

    it('returns to the page the search was started from', async () => {
        const server = fakeServer();
        server.get(SEARCH, found([]));

        open('?returnPath=%2F2001%2F06-15');

        await expect.element(page.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/2001/06-15');
    });

    // The link is the reader's to click, so a crafted one must not lead off this site or, as a `javascript:` URL would,
    // run as script on it. A data URL stands in for that one, which lint refuses to have written down.
    it.each([
        { name: 'a URL that is no page at all', returnPath: 'data:text/html,hi' },
        { name: 'another site', returnPath: 'https://example.com/2001' },
    ])('returns home when the search was started from $name', async ({ returnPath }) => {
        const server = fakeServer();
        server.get(SEARCH, found([]));

        open(`?returnPath=${encodeURIComponent(returnPath)}`);

        await expect.element(page.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/');
    });

    it('returns home from a search that was started nowhere, as from a bookmark', async () => {
        const server = fakeServer();
        server.get(SEARCH, found([]));

        open();

        await expect.element(page.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/');
    });

    describe('searching again', () => {
        it('searches within the years and in the order the reader has set', async () => {
            const server = fakeServer();
            server.get(SEARCH, found(photos(1, 2)));
            open('?returnPath=%2F2001');
            await page.getByRole('textbox', { name: 'search' }).fill('cake');
            await page.getByRole('spinbutton', { name: 'Oldest year' }).fill('2001');
            await page.getByRole('spinbutton', { name: 'Newest year' }).fill('2005');
            await page.getByRole('checkbox', { name: 'Oldest first:' }).click();

            await page.getByRole('button', { name: 'Search' }).click();

            expect(goto).toHaveBeenCalledExactlyOnceWith(
                '/search/cake?returnPath=%2F2001&oldest=2001&newest=2005&oldestFirst=true',
            );
        });

        it('shows the years and the order the results were searched with', async () => {
            const server = fakeServer();
            server.get(SEARCH, found(photos(1, 2)));

            open('?oldest=2001&newest=2005&oldestFirst=true');

            await expect.element(page.getByRole('spinbutton', { name: 'Oldest year' })).toHaveValue(2001);
            await expect.element(page.getByRole('spinbutton', { name: 'Newest year' })).toHaveValue(2005);
            await expect.element(page.getByRole('checkbox', { name: 'Oldest first:' })).toBeChecked();
            expect(server.rawCalls.map((call) => call.url.search)).toStrictEqual([
                '?oldest=2001&newest=2005&oldestFirst=true&pageSize=30',
            ]);
        });
    });

    describe('when there are more matches than the first page', () => {
        /**
         * A page of two leaves the end of the list on screen however many pages have arrived, so nothing the reader
         * does will ask for the next one: each page's arrival has to.
         */
        it('fetches page after page while the end of the list is on screen, and stops at the last match', async () => {
            const server = fakeServer();
            server.get(SEARCH, found(photos(1, 2), 5), found(photos(3, 2), 5), found(photos(5, 1), 5));

            open();

            await expect.element(page.getByRole('link', { name: 'Photo 5', exact: true })).toBeVisible();

            await intersectionsReported();

            expect(startsAskedFor(server)).toStrictEqual([null, '2', '4']);

            await expect.element(page.getByText('Loading...')).not.toBeInTheDocument();
        });

        it('fetches the next page only when the reader scrolls to the end of the list', async () => {
            const server = fakeServer();
            server.get(SEARCH, found(photos(1, 30), 31), found(photos(31, 1), 31));
            open();

            await expect.element(page.getByRole('link', { name: 'Photo 1', exact: true })).toBeVisible();

            await intersectionsReported();

            expect(startsAskedFor(server)).toStrictEqual([null]);

            page.getByRole('link', { name: 'Photo 30', exact: true }).element().scrollIntoView();

            await expect.element(page.getByRole('link', { name: 'Photo 31', exact: true })).toBeVisible();

            expect(startsAskedFor(server)).toStrictEqual([null, '30']);
        });

        /**
         * The page that arrives pushes the end of the list off screen, which the browser reports only after it has
         * drawn the page: a fetch decided on what it last reported would take the next page too, and the one after.
         */
        it('fetches one page for one scroll to the end of the list, however many more there are', async () => {
            const server = fakeServer();
            server.get(
                SEARCH,
                found(photos(1, 30), 120),
                found(photos(31, 30), 120),
                found(photos(61, 30), 120),
                found(photos(91, 30), 120),
            );
            open();

            await expect.element(page.getByRole('link', { name: 'Photo 1', exact: true })).toBeVisible();

            page.getByRole('link', { name: 'Photo 30', exact: true }).element().scrollIntoView();

            await expect.element(page.getByRole('link', { name: 'Photo 60', exact: true })).toBeInTheDocument();

            await intersectionsReported();

            expect(startsAskedFor(server)).toStrictEqual([null, '30']);
        });

        it('keeps every page the reader reached when the router loads the results again, without searching again', async () => {
            const server = fakeServer();
            server.get(SEARCH, found(photos(1, 30), 31), found(photos(31, 1), 31));
            const shown = open();

            await expect.element(page.getByRole('link', { name: 'Photo 1', exact: true })).toBeVisible();

            page.getByRole('link', { name: 'Photo 30', exact: true }).element().scrollIntoView();

            await expect.element(page.getByRole('link', { name: 'Photo 31', exact: true })).toBeVisible();

            shown.rerender(visit());

            await expect.element(page.getByRole('link', { name: 'Photo 1', exact: true })).toBeInTheDocument();
            await expect.element(page.getByRole('link', { name: 'Photo 31', exact: true })).toBeInTheDocument();
            expect(startsAskedFor(server)).toStrictEqual([null, '30']);
        });

        it('keeps the matches it has and says so when the next page fails', async () => {
            const server = fakeServer();
            server.get(SEARCH, found(photos(1, 2), 5), serverError());

            open();

            await expect.element(page.getByText('Error loading more results')).toBeVisible();
            await expect.element(page.getByRole('link', { name: 'Photo 2', exact: true })).toBeVisible();
        });
    });
});
