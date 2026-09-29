import { type BrowserContext, type Locator, type Page, expect } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { adminCookie } from '@tacocat-gallery/api/test/secrets';
import { executeLocalSql } from '@tacocat-gallery/api/test/stack';
import { E2E_STATE } from './gallery.ts';

/** Signs the context in as the test admin, with the cookie the Worker would have set at login. */
export async function signInAsAdmin(context: BrowserContext): Promise<void> {
    const [name = '', value = ''] = (await adminCookie()).split('=', 2);
    await context.addCookies([{ name, value, domain: 'localhost', path: '/' }]);
}

/**
 * A new invite for `username`, stored as api/scripts/invite.sh stores one: only its token's hash. No route writes an
 * invite, so it goes into the running site's database directly, and a retry or a rerun against a reused server gets
 * one of its own.
 */
export async function mintInvite(username: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(token).digest('hex');
    const sql = `INSERT INTO invite (token_hash, username, expires_at)
        VALUES ('${hash}', '${username}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 day'))`;
    await executeLocalSql(E2E_STATE, sql);
    return token;
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

/** The file names of every stylesheet the page has fetched, as in `MediaDetail.BCFLIRHq.css`. */
export async function fetchedStylesheets(page: Page): Promise<string[]> {
    return page.evaluate(() =>
        performance
            .getEntriesByType('resource')
            .map((entry) => new URL(entry.name).pathname)
            .filter((pathname) => pathname.endsWith('.css'))
            .map((pathname) => pathname.slice(pathname.lastIndexOf('/') + 1)),
    );
}

/** How many bytes each fetch of `url`, a path and query on the site, moved, in the order the page made them; 0 for one answered from a cache. */
export async function bytesFetched(page: Page, url: string): Promise<number[]> {
    return page.evaluate(
        (wanted) =>
            performance
                .getEntriesByType('resource')
                .filter((entry) => entry instanceof PerformanceResourceTiming)
                .filter((entry) => `${new URL(entry.name).pathname}${new URL(entry.name).search}` === wanted)
                .map((entry) => entry.transferSize),
        url,
    );
}

/** When the first fetch of `url` started, in ms from the page's start; undefined until the page asks for it. */
export async function fetchStarted(page: Page, url: string): Promise<number | undefined> {
    return page.evaluate(
        (wanted) =>
            performance
                .getEntriesByType('resource')
                .find((entry) => `${new URL(entry.name).pathname}${new URL(entry.name).search}` === wanted)?.startTime,
        url,
    );
}

/** When the page's load event fired, in ms from the page's start. */
export async function loadEventStart(page: Page): Promise<number> {
    return page.evaluate(() => {
        const [navigation] = performance.getEntriesByType('navigation');
        return navigation instanceof PerformanceNavigationTiming ? navigation.loadEventStart : 0;
    });
}
