import { type Page, expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
    ADMIN_DAY_PATH,
    ADMIN_PHOTO_PATH,
    ADMIN_REPLACED_BASE_NAME,
    ADMIN_SECOND_PHOTO_PATH,
    ADMIN_UPLOAD_DAY_PATH,
    ADMIN_YEAR_PATH,
} from './gallery.ts';
import { revealAdminControls, signInAsAdmin } from './support.ts';

const JPEG_FIXTURE = fileURLToPath(new URL('../api/fixtures/FullMetadata.jpg', import.meta.url));
const PNG_FIXTURE = fileURLToPath(new URL('../api/fixtures/pngFormat.png', import.meta.url));

/** A month for each attempt of the album journey: its number, and its name as a day's title and as a year's link spell it. */
const MONTHS = [
    ['03', 'March', 'Mar'],
    ['04', 'April', 'Apr'],
    ['05', 'May', 'May'],
] as const;

/** Runs in the page: whether the cropper's image, which carries no alt text and so no role, has loaded. */
function cropperImageLoaded(): boolean {
    const image = document.querySelector<HTMLImageElement>('section[aria-label="Media"] img');
    return image !== null && image.complete && image.naturalWidth > 0;
}

/** How long the local pipeline may take to make an upload into an item: two derivatives through the Images binding. */
const PIPELINE_TIMEOUT = 30_000;

/**
 * The replacement to make next: the photo is a JPEG or a PNG depending on what the last run left, and the file dropped
 * on it is the other format, so each run changes its extension and a rerun has something to replace.
 */
function replacementFor(albumJson: unknown): { target: string; fixture: string; mimeType: string; result: string } {
    const children =
        typeof albumJson === 'object' &&
        albumJson !== null &&
        'children' in albumJson &&
        Array.isArray(albumJson.children)
            ? albumJson.children
            : [];
    const isPng = children.some(
        (child: unknown) =>
            typeof child === 'object' &&
            child !== null &&
            'path' in child &&
            child.path === `${ADMIN_UPLOAD_DAY_PATH}${ADMIN_REPLACED_BASE_NAME}.png`,
    );
    const base = `${ADMIN_UPLOAD_DAY_PATH}${ADMIN_REPLACED_BASE_NAME}`;
    return isPng
        ? { target: `${base}.png`, fixture: JPEG_FIXTURE, mimeType: 'image/jpeg', result: `${base}.jpg` }
        : { target: `${base}.jpg`, fixture: PNG_FIXTURE, mimeType: 'image/png', result: `${base}.png` };
}

/** Of the admin day's two photos, the one that is not its thumbnail in the API's answer for the album. */
function photoNotTheThumbnail(albumJson: unknown): string {
    const thumbnail =
        typeof albumJson === 'object' && albumJson !== null && 'thumbnail' in albumJson
            ? albumJson.thumbnail
            : undefined;
    const path =
        typeof thumbnail === 'object' && thumbnail !== null && 'path' in thumbnail ? thumbnail.path : undefined;
    return path === ADMIN_PHOTO_PATH ? ADMIN_SECOND_PHOTO_PATH : ADMIN_PHOTO_PATH;
}

/** The album as the API answers for it, read to check what a journey wrote. */
async function album(page: Page, path: string): Promise<unknown> {
    const response = await page.request.get(`/api/album${path}`);
    return response.json();
}

test.describe('an admin', () => {
    test.beforeEach(async ({ context }) => {
        await signInAsAdmin(context);
    });

    // A retry runs against the same site, so each attempt takes a month of its own
    test('creates a day album, captions and publishes it, renames it and deletes it', async ({
        page,
        browser,
    }, testInfo) => {
        const [month, monthName, monthAbbreviation] = MONTHS[testInfo.retry] ?? MONTHS[0];
        const dayPath = `${ADMIN_YEAR_PATH}${month}-01/`;
        const dayTitle = `${monthName} 1, 2003`;
        const summary = 'Made by the admin journey';

        await test.step('the year offers a new album, which is named in a dialog', async () => {
            await page.goto(ADMIN_YEAR_PATH);
            await revealAdminControls(page);
            await page.getByRole('button', { name: 'New Album' }).click();
            await page.getByLabel('New Album Name').fill(`${month}-01`);
            await page.getByRole('button', { name: 'Confirm' }).click();

            await expect(page).toHaveURL(`/2003/${month}-01`);
            await expect(page).toHaveTitle(dayTitle);
        });

        await test.step('a guest cannot see the new album yet', async () => {
            const guest = await browser.newPage();
            const response = await guest.request.get(`/api/album${dayPath}`);
            expect(response.status()).toBe(404);
            await guest.close();
        });

        await test.step('edit mode saves a summary and publishes the album', async () => {
            await revealAdminControls(page);
            await page.getByRole('button', { name: 'Edit' }).click();
            await page.getByRole('textbox').fill(summary);
            await page.getByRole('checkbox').check();
            await page.getByRole('button', { name: 'Save' }).click();

            await expect(page.getByText('✅ saved')).toBeVisible();
            await page.getByRole('button', { name: 'Cancel' }).click();
        });

        await test.step('the year shows the summary, and a guest can open the album now', async () => {
            await page.goto(ADMIN_YEAR_PATH);
            await expect(page.getByText(summary)).toBeVisible();

            const guest = await browser.newPage();
            await guest.goto(dayPath);
            await expect(guest).toHaveTitle(dayTitle);
            await guest.close();
        });

        await test.step('renaming moves the album to its new date', async () => {
            await page.goto(dayPath);
            await revealAdminControls(page);
            await page.getByRole('button', { name: 'Rename' }).click();
            await page.getByLabel('New Album Name').fill(`${month}-02`);
            await page.getByRole('button', { name: 'Confirm' }).click();

            await expect(page).toHaveURL('/2003');
            await expect(page.getByRole('link', { name: `${monthAbbreviation} 2`, exact: true })).toBeVisible();
            await expect(page.getByRole('link', { name: `${monthAbbreviation} 1`, exact: true })).toBeHidden();
        });

        await test.step('deleting the empty album returns to the year without it', async () => {
            await page.goto(`${ADMIN_YEAR_PATH}${month}-02/`);
            await revealAdminControls(page);
            await page.getByRole('button', { name: 'Delete' }).click();

            await expect(page).toHaveURL('/2003');
            await expect(page.getByRole('link', { name: `${monthAbbreviation} 2`, exact: true })).toBeHidden();
        });
    });

    test('captions a photo, makes it the thumbnail of its year, and recuts its own thumbnail', async ({ page }) => {
        // Unique, so that a rerun against the same site still changes the title
        const newTitle = `Photo, captioned at ${Date.now()}`;

        await test.step('edit mode saves a new title', async () => {
            await page.goto(ADMIN_PHOTO_PATH);
            await revealAdminControls(page);
            await page.getByRole('button', { name: 'Edit' }).click();
            // The title is edited in place, in an element with no role of its own, so it is found by what it says
            const heading = page.getByRole('heading', { level: 1 });
            const currentTitle = (await heading.innerText()).trim();
            await heading.getByText(currentTitle, { exact: true }).fill(newTitle);
            await page.getByRole('button', { name: 'Save' }).click();

            await expect(page.getByText('✅ saved')).toBeVisible();
            await page.getByRole('button', { name: 'Cancel' }).click();
            await expect(page).toHaveTitle(newTitle);
        });

        await test.step('the year takes the photo as its thumbnail after a confirmation', async () => {
            await revealAdminControls(page);
            await page.getByRole('button', { name: 'Year' }).click();
            await page.getByRole('button', { name: 'Set Year Thumb' }).click();

            await expect
                .poll(async () => album(page, ADMIN_YEAR_PATH))
                .toMatchObject({ thumbnail: { path: ADMIN_PHOTO_PATH } });
        });

        // The day has two photos and one is always its thumbnail, so a rerun has a star to press
        await test.step("the day's edit page stars the photo that is not its thumbnail", async () => {
            const other = photoNotTheThumbnail(await album(page, ADMIN_DAY_PATH));
            await page.goto(ADMIN_DAY_PATH);
            await revealAdminControls(page);
            await page.getByRole('button', { name: 'Edit' }).click();
            await page.getByRole('button', { name: 'Set as album thumbnail' }).click();

            await expect.poll(async () => album(page, ADMIN_DAY_PATH)).toMatchObject({ thumbnail: { path: other } });
            await page.getByRole('button', { name: 'Cancel' }).click();
        });

        await test.step('the crop page cuts a square from the photo and saves it', async () => {
            await page.goto(ADMIN_PHOTO_PATH);
            await revealAdminControls(page);
            await page.getByRole('button', { name: 'Crop' }).click();
            await expect(page).toHaveURL(`${ADMIN_PHOTO_PATH}/crop`);
            // The cropper chooses its first rectangle when the image has loaded; a save before that has nothing to send
            await expect.poll(async () => page.evaluate(cropperImageLoaded)).toBe(true);
            await page.getByRole('button', { name: 'Save' }).click();

            await expect(page).toHaveURL(ADMIN_PHOTO_PATH);
            await expect
                .poll(async () => album(page, ADMIN_DAY_PATH))
                .toMatchObject({
                    children: expect.arrayContaining([
                        expect.objectContaining({
                            path: ADMIN_PHOTO_PATH,
                            thumbnail: expect.objectContaining({ width: 3024, height: 3024 }),
                        }),
                    ]),
                });
        });
    });

    test('uploads a photo into a day and sees it arrive, then replaces a photo with one in another format', async ({
        page,
    }, testInfo) => {
        // A retry runs against the same site, where the earlier attempt's upload is already an item
        const uploadName = `upload_${testInfo.retry}.jpg`;

        await test.step('a dropped photo is presigned, put, and made into an item with the caption the file carries', async () => {
            await page.goto(ADMIN_UPLOAD_DAY_PATH);
            await revealAdminControls(page);
            const chooser = page.waitForEvent('filechooser');
            const presigned = page.waitForResponse(`/api/presigned${ADMIN_UPLOAD_DAY_PATH}`);
            await page.getByRole('button', { name: 'Upload' }).click();
            await (
                await chooser
            ).setFiles({ name: uploadName, mimeType: 'image/jpeg', buffer: await readFile(JPEG_FIXTURE) });

            expect((await presigned).status()).toBe(200);
            // The local pipeline can finish before the app's first poll, so the "processing" status may never show
            await expect
                .poll(async () => album(page, ADMIN_UPLOAD_DAY_PATH), { timeout: PIPELINE_TIMEOUT })
                .toMatchObject({
                    children: expect.arrayContaining([
                        expect.objectContaining({
                            path: `${ADMIN_UPLOAD_DAY_PATH}${uploadName}`,
                            title: 'My Image Title',
                        }),
                    ]),
                });
            await expect(page.getByText('1 processing')).toBeHidden();
        });

        await test.step('a file in another format replaces the photo under its own name, and the album shows it', async () => {
            const { target, fixture, mimeType, result } = replacementFor(await album(page, ADMIN_UPLOAD_DAY_PATH));
            await page.goto(target);
            await revealAdminControls(page);
            const chooser = page.waitForEvent('filechooser');
            const presigned = page.waitForResponse(`/api/presigned${ADMIN_UPLOAD_DAY_PATH}`);
            await page.getByRole('button', { name: 'Replace' }).click();
            await (
                await chooser
            ).setFiles({ name: `new.${fixture.split('.').pop() ?? ''}`, mimeType, buffer: await readFile(fixture) });

            const response = await presigned;
            expect(response.status()).toBe(200);
            expect(response.request().postDataJSON()).toStrictEqual([{ path: result, replaces: target }]);
            await expect(page).toHaveURL(ADMIN_UPLOAD_DAY_PATH.slice(0, -1));
            await expect
                .poll(async () => album(page, ADMIN_UPLOAD_DAY_PATH), { timeout: PIPELINE_TIMEOUT })
                .toMatchObject({
                    children: expect.arrayContaining([expect.objectContaining({ path: result, title: 'Replace me' })]),
                });
            await expect(page.getByText('1 processing')).toBeHidden();
        });
    });
});
