import { expect, test } from '@playwright/test';
import { mediaImage, preloadedImages } from './support.ts';

const DAY_TITLE = 'June 15, 2001';
// The Worker's URL for each photo at the size the media page shows it: the landscape one by width, the portrait by height.
const CAKE_DETAIL = '/i/2001/06-15/cake.jpg/v1?size=1024';
const FELIX_DETAIL = '/i/2001/06-15/felix.jpg/v1?size=x1024';

test.describe('the site', () => {
    test('asks search engines to stay out', async ({ page }) => {
        await page.goto('/');

        const robots = await page.evaluate(() =>
            document.querySelector('meta[name="robots"]')?.getAttribute('content'),
        );

        expect(robots).toBe('noindex');
    });

    test('links from the root down to a day', async ({ page }) => {
        await test.step('the root album lists its years', async () => {
            await page.goto('/');

            await expect(page).toHaveTitle('The Moses Family');

            await page.getByRole('link', { name: '2001', exact: true }).click();

            await expect(page).toHaveURL('/2001');
        });

        await test.step('a year lists its days by date, with their captions', async () => {
            await expect(page.getByText('Felix turns one')).toBeVisible();

            await page.getByRole('link', { name: 'Jun 15', exact: true }).click();

            await expect(page).toHaveURL('/2001/06-15');
            await expect(page).toHaveTitle(DAY_TITLE);
        });
    });
});

/** What the reader of the weekly email does: opens the day it links to, then clicks through its photos. */
test.describe('a reader arriving at a day album', () => {
    test('clicks through its photos, each already requested before the click', async ({ page }) => {
        await test.step('the day links along to the newer day and down to its photos', async () => {
            await page.goto('/2001/06-15');

            await expect(page).toHaveTitle(DAY_TITLE);
            await expect(page.getByRole('link', { name: 'Jul 4', exact: true })).toHaveAttribute('href', '/2001/07-04');

            await page.getByRole('link', { name: 'Cake', exact: true }).click();

            await expect(page).toHaveURL('/2001/06-15/cake.jpg');
        });

        await test.step('the photo is asked for at its display size, and the next one is being fetched ahead', async () => {
            await expect(mediaImage(page)).toHaveAttribute('src', CAKE_DETAIL);
            await expect.poll(async () => preloadedImages(page)).toContain(FELIX_DETAIL);
        });

        await test.step('next shows the following photo, the last of the day', async () => {
            await page.getByRole('link', { name: 'Next', exact: true }).click();

            await expect(page).toHaveURL('/2001/06-15/felix.jpg');
            await expect(page).toHaveTitle('Felix');
            await expect(mediaImage(page)).toHaveAttribute('src', FELIX_DETAIL);
            await expect(page.getByRole('link', { name: 'Next', exact: true })).toHaveAttribute(
                'aria-disabled',
                'true',
            );
        });

        await test.step('up returns to the day', async () => {
            await page.getByRole('link', { name: DAY_TITLE, exact: true }).click();

            await expect(page).toHaveURL('/2001/06-15');
        });
    });
});
