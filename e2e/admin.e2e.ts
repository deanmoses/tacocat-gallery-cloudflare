import { type Page, expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { ADMIN_DAY_PATH, ADMIN_PHOTO_PATH, ADMIN_SECOND_PHOTO_PATH, ADMIN_YEAR_PATH } from './gallery.ts';
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

    test('uploads a photo into a day, and replaces a photo with one in another format', async ({ page }) => {
        // The browser PUTs to the account's bucket, which no test reaches; the URL is what presign signed for it.
        const puts: string[] = [];
        await page.route('https://*.r2.cloudflarestorage.com/**', async (route) => {
            puts.push(route.request().url());
            await route.fulfill({ status: 200 });
        });

        await test.step('the upload button asks for files and presigns a URL per file', async () => {
            await page.goto(ADMIN_DAY_PATH);
            await revealAdminControls(page);
            const chooser = page.waitForEvent('filechooser');
            const presigned = page.waitForResponse(`/api/presigned${ADMIN_DAY_PATH}`);
            await page.getByRole('button', { name: 'Upload' }).click();
            await (await chooser).setFiles(JPEG_FIXTURE);

            const response = await presigned;
            expect(response.status()).toBe(200);
            const uploads: unknown = await response.json();
            expect(uploads).toStrictEqual({
                [`${ADMIN_DAY_PATH}fullmetadata.jpg`]: { url: expect.any(String), versionId: expect.any(String) },
            });
            await expect.poll(() => puts).toHaveLength(1);
            expect(puts[0]).toContain('/inbox/');
            await expect(page.getByText('1 processing')).toBeVisible();
        });

        await test.step('replacing a photo with a PNG keeps its name, and goes to the album to watch', async () => {
            await page.goto(ADMIN_PHOTO_PATH);
            await revealAdminControls(page);
            const chooser = page.waitForEvent('filechooser');
            const presigned = page.waitForResponse(`/api/presigned${ADMIN_DAY_PATH}`);
            await page.getByRole('button', { name: 'Replace' }).click();
            await (await chooser).setFiles(PNG_FIXTURE);

            const response = await presigned;
            expect(response.status()).toBe(200);
            expect(response.request().postDataJSON()).toStrictEqual([
                { path: `${ADMIN_DAY_PATH}photo.png`, replaces: ADMIN_PHOTO_PATH },
            ]);
            await expect(page).toHaveURL('/2003/08-01');
            await expect(page.getByText('pngFormat.png')).toBeVisible();
        });
    });
});
