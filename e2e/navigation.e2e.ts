import { expect, test } from '@playwright/test';

test.describe('the album pages', () => {
    test('a visitor walks from the root album down to a photo, then along to the next', async ({ page }) => {
        await test.step('the root album links to its years', async () => {
            await page.goto('/');

            await expect(page).toHaveTitle('Tacocat Gallery');

            await page.getByRole('link', { name: '2001' }).click();

            await expect(page).toHaveURL('/2001');
        });

        await test.step('a year links to its days', async () => {
            await expect(page.getByRole('heading', { level: 1 })).toHaveText('2001');

            await page.getByRole('link', { name: 'Felix turns one' }).click();

            await expect(page).toHaveURL('/2001/06-15');
        });

        await test.step('a day links to the albums either side and to its photos', async () => {
            await expect(page.getByRole('heading', { level: 1 })).toHaveText('Felix turns one');
            await expect(page.getByRole('link', { name: 'Next: July 4, 2001' })).toHaveAttribute('href', '/2001/07-04');

            await page.getByRole('img', { name: 'Cake' }).click();

            await expect(page).toHaveURL('/2001/06-15/cake.jpg');
        });

        await test.step('a photo links to the next one in its day', async () => {
            await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cake');

            await page.getByRole('link', { name: 'Next: Felix' }).click();

            await expect(page).toHaveURL('/2001/06-15/felix.jpg');
            await expect(page.getByRole('heading', { level: 1 })).toHaveText('Felix');
            await expect(page.getByRole('link', { name: 'Up: Felix turns one' })).toHaveAttribute(
                'href',
                '/2001/06-15',
            );
        });
    });
});
