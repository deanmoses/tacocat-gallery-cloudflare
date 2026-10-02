import { type Locator, type Page, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { testVersionId } from '@tacocat-gallery/api/test/version-id';
import { putItem, readAlbum, setThumbnail, uploadFile } from './api.ts';
import { E2E_ORIGIN } from './gallery.ts';
import { revealAdminControls, adminTest as test } from './support.ts';

const JPEG_FIXTURE = fileURLToPath(import.meta.resolve('@tacocat-gallery/api/fixtures/FullMetadata.jpg'));
const PNG_FIXTURE = fileURLToPath(import.meta.resolve('@tacocat-gallery/api/fixtures/pngFormat.png'));
/** The title the pipeline reads from the JPEG fixture's metadata. */
const JPEG_TITLE = 'My Image Title';

/** Runs in the page: whether the cropper's image, which carries no alt text and so no role, has loaded. */
function cropperImageLoaded(): boolean {
    const image = document.querySelector<HTMLImageElement>('section[aria-label="Media"] img');
    return image !== null && image.complete && image.naturalWidth > 0;
}

/** How long the local pipeline may take to make an upload into an item: two derivatives through the Images binding. */
const PIPELINE_TIMEOUT = 30_000;

/**
 * Writes a published day album into `year`, with a photo for each `name: title` in `photos`. The photos are rows with
 * no file behind them, each under a version id read from its year, day and place, which the year makes unique to this
 * attempt.
 */
async function seedDay(year: string, day: string, photos: Record<string, string> = {}): Promise<string> {
    const yearPath = `/${year}/`;
    const dayPath = `${yearPath}${day}/`;
    await putItem(E2E_ORIGIN, { parentPath: yearPath, itemName: day, itemType: 'album', published: true });
    await Promise.all(
        Object.entries(photos).map(async ([itemName, title], index) =>
            putItem(E2E_ORIGIN, {
                parentPath: dayPath,
                itemName,
                itemType: 'media',
                mediaType: 'image',
                title,
                versionId: testVersionId(`${year}${day}${index}`),
                width: 4032,
                height: 3024,
            }),
        ),
    );
    return dayPath;
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

test.describe('an admin', () => {
    test('creates a day album, captions and publishes it, renames it and deletes it', async ({
        page,
        browser,
        year,
    }) => {
        const yearPath = `/${year}/`;
        const dayPath = `${yearPath}03-01/`;
        const dayTitle = `March 1, ${year}`;
        const summary = 'Made by the admin journey';

        await test.step('the year offers a new album, which is named in a dialog', async () => {
            await page.goto(yearPath);
            await revealAdminControls(page);
            await page.getByRole('button', { name: 'New Album' }).click();
            await page.getByLabel('New Album Name').fill('03-01');
            await page.getByRole('button', { name: 'Confirm' }).click();

            await expect(page).toHaveURL(`/${year}/03-01`);
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
            await page.goto(yearPath);
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
            await page.getByLabel('New Album Name').fill('03-02');
            await page.getByRole('button', { name: 'Confirm' }).click();

            await expect(page).toHaveURL(`/${year}/03-02`);
            await expect(page).toHaveTitle(`March 2, ${year}`);
            await page.goto(yearPath);
            await expect(page.getByRole('link', { name: 'Mar 2', exact: true })).toBeVisible();
            await expect(page.getByRole('link', { name: 'Mar 1', exact: true })).toBeHidden();
        });

        await test.step('deleting the empty album returns to the year without it', async () => {
            await page.goto(`${yearPath}03-02/`);
            await revealAdminControls(page);
            await page.getByRole('button', { name: 'Delete' }).click();

            await expect(page).toHaveURL(`/${year}`);
            await expect(page.getByRole('link', { name: 'Mar 2', exact: true })).toBeHidden();
        });
    });

    test('captions a photo, makes it the thumbnail of its year, and recuts its own thumbnail', async ({
        page,
        year,
    }) => {
        const newTitle = 'Photo, captioned';
        const dayPath = await seedDay(year, '08-01', { second: 'Second' });
        const photoPath = `${dayPath}photo`;
        // Uploaded rather than written as a row, since the crop step cuts the thumbnail from the original
        await uploadFile(E2E_ORIGIN, photoPath, JPEG_FIXTURE);
        await expect
            .poll(async () => (await readAlbum(E2E_ORIGIN, dayPath)).children?.map(({ path }) => path), {
                timeout: PIPELINE_TIMEOUT,
            })
            .toContain(photoPath);
        await setThumbnail(E2E_ORIGIN, dayPath, photoPath);

        await test.step('edit mode saves a new title', async () => {
            await page.goto(photoPath);
            await revealAdminControls(page);
            await page.getByRole('button', { name: 'Edit' }).click();
            // The title is edited in place, in an element with no role of its own, so it is found by what it says
            await page.getByRole('heading', { level: 1 }).getByText(JPEG_TITLE, { exact: true }).fill(newTitle);
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
                .poll(async () => readAlbum(E2E_ORIGIN, `/${year}/`))
                .toMatchObject({ thumbnail: { path: photoPath } });
        });

        await test.step("the day's edit page stars the photo that is not its thumbnail", async () => {
            await page.goto(dayPath);
            await revealAdminControls(page);
            await page.getByRole('button', { name: 'Edit' }).click();
            await page.getByRole('button', { name: 'Set as album thumbnail' }).click();

            await expect
                .poll(async () => readAlbum(E2E_ORIGIN, dayPath))
                .toMatchObject({ thumbnail: { path: `${dayPath}second` } });
            await page.getByRole('button', { name: 'Cancel' }).click();
        });

        await test.step('the crop page cuts a square from the photo and saves it', async () => {
            await page.goto(photoPath);
            await revealAdminControls(page);
            await page.getByRole('button', { name: 'Crop' }).click();
            await expect(page).toHaveURL(`${photoPath}/crop`);
            // The cropper chooses its first rectangle when the image has loaded; a save before that has nothing to send
            await expect.poll(async () => page.evaluate(cropperImageLoaded)).toBe(true);
            await page.getByRole('button', { name: 'Save' }).click();

            await expect(page).toHaveURL(photoPath);
            // The JPEG fixture is 300 by 225, so the largest square it holds is 225 on a side
            await expect
                .poll(async () => readAlbum(E2E_ORIGIN, dayPath))
                .toMatchObject({
                    children: expect.arrayContaining([
                        expect.objectContaining({
                            path: photoPath,
                            thumbnail: expect.objectContaining({ width: 225, height: 225 }),
                        }),
                    ]),
                });
        });
    });

    test('uploads a photo into a day and sees it arrive, then replaces a photo with one in another format', async ({
        page,
        year,
    }) => {
        const dayPath = await seedDay(year, '09-01', { replace_me: 'Replace me' });

        await test.step('a dropped photo is presigned, put, and made into an item with the caption the file carries', async () => {
            await page.goto(dayPath);
            await revealAdminControls(page);
            const chooser = page.waitForEvent('filechooser');
            const presigned = page.waitForResponse(`/api/presigned${dayPath}`);
            await page.getByRole('button', { name: 'Upload' }).click();
            await (
                await chooser
            ).setFiles({ name: 'upload.jpg', mimeType: 'image/jpeg', buffer: await readFile(JPEG_FIXTURE) });

            expect((await presigned).status()).toBe(200);
            // The local pipeline can finish before the app's first poll, so the "processing" status may never show
            await expect
                .poll(async () => readAlbum(E2E_ORIGIN, dayPath), { timeout: PIPELINE_TIMEOUT })
                .toMatchObject({
                    children: expect.arrayContaining([
                        expect.objectContaining({ path: `${dayPath}upload`, title: JPEG_TITLE }),
                    ]),
                });
            await expect(page.getByText('1 processing')).toBeHidden();
        });

        await test.step('a file in another format replaces the photo under its own name, and the page stays on it', async () => {
            const target = `${dayPath}replace_me`;
            await page.goto(target);
            await revealAdminControls(page);
            const chooser = page.waitForEvent('filechooser');
            const presigned = page.waitForResponse(`/api/presigned${dayPath}`);
            await page.getByRole('button', { name: 'Replace' }).click();
            await (
                await chooser
            ).setFiles({ name: 'new.png', mimeType: 'image/png', buffer: await readFile(PNG_FIXTURE) });

            const response = await presigned;
            expect(response.status()).toBe(200);
            expect(response.request().postDataJSON()).toStrictEqual([
                { path: target, extension: 'png', replace: true },
            ]);
            await expect(page).toHaveURL(target);
            // The PNG fixture's size, which the seeded row did not have, says the file behind the item changed
            await expect
                .poll(async () => readAlbum(E2E_ORIGIN, dayPath), { timeout: PIPELINE_TIMEOUT })
                .toMatchObject({
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

    test("drags a day album's photos into an order of its own, and puts them back in name order", async ({
        page,
        year,
    }) => {
        const dayPath = await seedDay(year, '10-01', { apple: 'Apple', banana: 'Banana', cherry: 'Cherry' });
        const titles = async (): Promise<string[]> =>
            page.getByRole('region', { name: 'Thumbnails' }).getByRole('link').allTextContents();

        await test.step('the album starts in name order', async () => {
            await page.goto(dayPath);

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
