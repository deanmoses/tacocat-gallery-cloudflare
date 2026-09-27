import { type Locator, type Page, expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
    ADMIN_DAY_PATH,
    ADMIN_PHOTO_PATH,
    ADMIN_REORDER_DAY_PATH,
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

/** The replacement the journey makes: a PNG dropped on the JPEG row the gallery seeds, which keeps its name. */
const REPLACEMENT = {
    target: `${ADMIN_UPLOAD_DAY_PATH}${ADMIN_REPLACED_BASE_NAME}`,
    fixture: PNG_FIXTURE,
    mimeType: 'image/png',
};

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

/** The version id of the album's child at `path` in the API's answer for the album, if it has that child. */
function childVersionId(albumJson: unknown, path: string): string | undefined {
    const children =
        typeof albumJson === 'object' && albumJson !== null && 'children' in albumJson ? albumJson.children : undefined;
    if (!Array.isArray(children)) return undefined;
    const child: unknown = children.find(
        (candidate: unknown) =>
            typeof candidate === 'object' && candidate !== null && 'path' in candidate && candidate.path === path,
    );
    return typeof child === 'object' && child !== null && 'versionId' in child && typeof child.versionId === 'string'
        ? child.versionId
        : undefined;
}

/** Presses on the middle of `from`, moves in steps to the middle of `to` and lets go, as a hand on a mouse would. */
async function drag(page: Page, from: Locator, to: Locator): Promise<void> {
    const start = await from.boundingBox();
    const end = await to.boundingBox();
    if (start === null || end === null) throw new Error('nothing to drag, or nowhere to drag it');
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 20 });
    await page.mouse.up();
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

            await expect(page).toHaveURL(`/2003/${month}-02`);
            await expect(page).toHaveTitle(`${monthName} 2, 2003`);
            await page.goto(ADMIN_YEAR_PATH);
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
    }) => {
        // A retry, or a rerun against a reused server, finds an earlier attempt's upload already an item
        const uploadName = `upload_${Date.now().toString(36)}`;

        await test.step('a dropped photo is presigned, put, and made into an item with the caption the file carries', async () => {
            await page.goto(ADMIN_UPLOAD_DAY_PATH);
            await revealAdminControls(page);
            const chooser = page.waitForEvent('filechooser');
            const presigned = page.waitForResponse(`/api/presigned${ADMIN_UPLOAD_DAY_PATH}`);
            await page.getByRole('button', { name: 'Upload' }).click();
            await (
                await chooser
            ).setFiles({ name: `${uploadName}.jpg`, mimeType: 'image/jpeg', buffer: await readFile(JPEG_FIXTURE) });

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

        await test.step('a file in another format replaces the photo under its own name, and the page stays on it', async () => {
            const { target, fixture, mimeType } = REPLACEMENT;
            // An earlier attempt may have replaced it already, so the new version is what says this one landed
            const replacedVersion = childVersionId(await album(page, ADMIN_UPLOAD_DAY_PATH), target);
            await page.goto(target);
            await revealAdminControls(page);
            const chooser = page.waitForEvent('filechooser');
            const presigned = page.waitForResponse(`/api/presigned${ADMIN_UPLOAD_DAY_PATH}`);
            await page.getByRole('button', { name: 'Replace' }).click();
            await (await chooser).setFiles({ name: 'new.png', mimeType, buffer: await readFile(fixture) });

            const response = await presigned;
            expect(response.status()).toBe(200);
            expect(response.request().postDataJSON()).toStrictEqual([{ path: target, replace: true }]);
            await expect(page).toHaveURL(target);
            await expect
                .poll(async () => childVersionId(await album(page, ADMIN_UPLOAD_DAY_PATH), target), {
                    timeout: PIPELINE_TIMEOUT,
                })
                .not.toBe(replacedVersion);
            // The PNG fixture's size, which the seeded row did not have, says the file behind the item changed
            await expect(album(page, ADMIN_UPLOAD_DAY_PATH)).resolves.toMatchObject({
                children: expect.arrayContaining([
                    expect.objectContaining({
                        path: target,
                        title: 'Replace me',
                        dimensions: { width: 220, height: 212 },
                    }),
                ]),
            });
            await expect(page.getByText('1 processing')).toBeHidden();
        });
    });

    test("drags a day album's photos into an order of its own, and puts them back in name order", async ({ page }) => {
        const titles = async (): Promise<string[]> =>
            page.getByRole('region', { name: 'Thumbnails' }).getByRole('link').allTextContents();
        // A retry runs against the same site, which the attempt before may have left reordered
        await page.request.delete(`/api/album-order${ADMIN_REORDER_DAY_PATH}`);

        await test.step('the album starts in name order', async () => {
            await page.goto(ADMIN_REORDER_DAY_PATH);

            await expect.poll(titles).toStrictEqual(['Apple', 'Banana', 'Cherry']);
        });

        await test.step('dragging a photo onto the next one and saving puts it after that one', async () => {
            await revealAdminControls(page);
            await page.getByRole('button', { name: 'Reorder' }).click();
            await drag(
                page,
                page.getByRole('listitem', { name: 'Apple' }),
                page.getByRole('listitem', { name: 'Banana' }),
            );
            await page.getByRole('button', { name: 'Save' }).click();

            await expect(page.getByRole('list', { name: 'Photos in album order' })).toBeHidden();
            await expect.poll(titles).toStrictEqual(['Banana', 'Apple', 'Cherry']);
        });

        await test.step("the order is the album's, not the page's", async () => {
            await page.reload();

            await expect.poll(titles).toStrictEqual(['Banana', 'Apple', 'Cherry']);
        });

        await test.step('resetting the order puts the photos back in name order', async () => {
            await revealAdminControls(page);
            await page.getByRole('button', { name: 'Reorder' }).click();
            await page.getByRole('button', { name: 'Reset order' }).click();

            await expect(page.getByRole('list', { name: 'Photos in album order' })).toBeHidden();
            await expect.poll(titles).toStrictEqual(['Apple', 'Banana', 'Cherry']);
        });
    });
});
