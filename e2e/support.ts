import { type BrowserContext, type Locator, type Page, expect, test } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { adminCookie } from '@tacocat-gallery/api/test/secrets';
import { executeLocalSql } from '@tacocat-gallery/api/test/stack';
import { createPublishedAlbum, readAlbum } from './api.ts';
import { E2E_ORIGIN, E2E_STATE } from './gallery.ts';

/**
 * A test signed in as the admin, with a published year no other attempt has had, as in `2002`, to write in. The
 * database outlives an attempt, on a retry and on a rerun against a reused server, so a fresh year is what makes every
 * attempt start from the same state.
 */
export const adminTest = test.extend<{ year: string }>({
    context: async ({ context }, use) => {
        await signInAsAdmin(context);
        await use(context);
    },
    year: async ({}, use) => {
        await use(await claimYear(E2E_ORIGIN));
    },
});

/** Signs the context in as the test admin, with the cookie the Worker would have set at login. */
async function signInAsAdmin(context: BrowserContext): Promise<void> {
    const [name = '', value = ''] = (await adminCookie()).split('=', 2);
    // A __Host- cookie belongs to its host alone, so it is set by URL rather than domain, and it has to be Secure,
    // which Chromium takes only for an https URL. The browser sends it to the http site on localhost all the same.
    const url = new URL(E2E_ORIGIN);
    url.protocol = 'https:';
    await context.addCookies([{ name, value, url: url.origin, secure: true }]);
}

/**
 * Creates the first year after the gallery's latest that no one has. Attempts running at once race for the same year,
 * and the Worker, which never makes an album twice, gives it to one of them; the rest try the next. Starting past the
 * latest spares a rerun asking after every year the runs before it took. A year has four digits.
 */
async function claimYear(origin: string): Promise<string> {
    const years = (await readAlbum(origin, '/')).children?.map((year) => Number(year.itemName)) ?? [];
    for (let year = Math.max(999, ...years) + 1; year <= 9999; year += 1) {
        if (await createPublishedAlbum(origin, `/${year}/`)) {
            return String(year);
        }
    }
    throw new Error('every year up to 9999 is taken; restart the e2e server');
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
