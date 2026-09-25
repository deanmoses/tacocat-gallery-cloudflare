import { type BrowserContext, type Locator, type Page, expect } from '@playwright/test';
import { adminCookie } from '../api/test/secrets.ts';

/** Signs the context in as the test admin, with the cookie the Worker would have set at login. */
export async function signInAsAdmin(context: BrowserContext): Promise<void> {
    const [name = '', value = ''] = (await adminCookie()).split('=', 2);
    await context.addCookies([{ name, value, domain: 'localhost', path: '/' }]);
}

/**
 * The admin's control strip sits in the top-left corner and shows only while the pointer is over it. It renders once
 * the session check has answered, and a strip appearing under a pointer that has not moved is not hovered, so the
 * pointer moves onto it after it exists. It is the one navigation landmark made of buttons.
 */
export async function revealAdminControls(page: Page): Promise<void> {
    const hidden = page
        .getByRole('navigation', { includeHidden: true })
        .filter({ has: page.getByRole('button', { includeHidden: true }) });
    await expect(hidden).toBeAttached();
    await page.mouse.move(8, 8);
    await page.mouse.move(12, 12);
    await expect(page.getByRole('navigation').filter({ has: page.getByRole('button') })).toBeVisible();
}

/** The photo or poster the media page shows, apart from the nav buttons' icons. */
export function mediaImage(page: Page): Locator {
    return page.getByRole('region', { name: 'Media' }).getByRole('img');
}

/** The images the page has asked the browser to fetch ahead of a click, by their URLs. */
export async function preloadedImages(page: Page): Promise<string[]> {
    return page.evaluate(() =>
        [...document.querySelectorAll('link[rel="preload"][as="image"]')].map(
            (link) => link.getAttribute('href') ?? '',
        ),
    );
}
