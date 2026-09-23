import type { Locator, Page } from '@playwright/test';

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
