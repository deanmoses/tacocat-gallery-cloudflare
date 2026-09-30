import { expect, test } from '@playwright/test';

/**
 * No admin journey writes the word the reader searches for, so the matches are the reader's gallery's alone: the day
 * captioned with it and the photo titled with it.
 */
test.describe('a reader looking for a photo', () => {
    test('searches from a day album, opens a match, and returns to the day', async ({ page }) => {
        await test.step('the day links to the search page, which remembers the day', async () => {
            await page.goto('/2001/06-15');
            await page.getByRole('link', { name: 'Search', exact: true }).click();

            await expect(page).toHaveURL('/search?returnPath=%2F2001%2F06-15');
            await expect(page.getByRole('textbox', { name: 'search' })).toBeFocused();
        });

        await test.step('a search finds the word whatever its case and accents', async () => {
            await page.getByRole('textbox', { name: 'search' }).fill('FÉLIX');
            await page.getByRole('button', { name: 'Search', exact: true }).click();

            await expect(page).toHaveURL('/search/F%C3%89LIX?returnPath=%2F2001%2F06-15');
            await expect(page).toHaveTitle('Search for FÉLIX');
            await expect(page.getByText('(2 results)')).toBeVisible();
            await expect(page.getByRole('link', { name: 'June 15, 2001', exact: true })).toHaveAttribute(
                'href',
                '/2001/06-15',
            );
            await expect(page.getByText('Felix turns one')).toBeVisible();
        });

        await test.step('a match opens the photo', async () => {
            await page.getByRole('link', { name: 'Felix', exact: true }).click();

            await expect(page).toHaveURL('/2001/06-15/felix');
            await expect(page).toHaveTitle('Felix');
        });

        await test.step('the browser goes back to the results it had, and the results back to the day', async () => {
            const searches: string[] = [];
            page.on('request', (request) => {
                if (new URL(request.url()).pathname.startsWith('/api/search/')) searches.push(request.url());
            });

            await page.goBack();

            await expect(page.getByText('(2 results)')).toBeVisible();
            expect(searches).toStrictEqual([]);

            await page.getByRole('link', { name: 'Back', exact: true }).click();

            await expect(page).toHaveURL('/2001/06-15');
        });
    });

    // A phone held sideways shows little more than the search controls, so the matches are below the fold.
    test('goes back from a match to where it was in the results', async ({ page }) => {
        await page.setViewportSize({ width: 400, height: 300 });
        await page.goto('/search/felix');
        const match = page.getByRole('link', { name: 'Felix', exact: true });
        await match.scrollIntoViewIfNeeded();
        const scrolled = await page.evaluate(() => window.scrollY);
        expect(scrolled).toBeGreaterThan(0);

        await match.click();
        await expect(page).toHaveTitle('Felix');
        await page.goBack();

        await expect.poll(async () => page.evaluate(() => window.scrollY)).toBe(scrolled);
    });

    test('narrows a search to years that hold no match, and is told there are none', async ({ page }) => {
        await page.goto('/search/felix');

        await expect(page.getByText('(2 results)')).toBeVisible();

        await page.getByRole('spinbutton', { name: 'Newest year' }).fill('2000');
        await page.getByRole('button', { name: 'Search', exact: true }).click();

        await expect(page).toHaveURL('/search/felix?returnPath=%2F&newest=2000');
        await expect(page.getByText('No results')).toBeVisible();
    });

    test("is told why a search for only words to leave out can't be made", async ({ page }) => {
        await page.goto('/search/-felix');

        await expect(page.getByText('A search needs a word to look for')).toBeVisible();
    });
});
