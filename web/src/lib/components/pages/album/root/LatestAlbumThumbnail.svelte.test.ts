import { beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from '$lib/test-support/render.svelte';
import LatestAlbumThumbnail from './LatestAlbumThumbnail.svelte';
import { resetAlbumState, seedLoadedAlbum } from '$lib/test-support/albumState';
import { albumRecord } from '$lib/test-support/records';
import { currentYearAlbumPath } from '$lib/utils/latestAlbum';
import { longDate } from '$lib/utils/date-utils';
import { albumPathToDate } from '$lib/utils/galleryPathUtils';
import type { AlbumGalleryItem } from '$lib/models/impl/server';

/**
 * The thumbnail is read off the current year album in the store. On a cold
 * visit that album lands after the root has rendered the page, and an admin
 * publishing a new album replaces it under the page, so the component has to
 * follow the store rather than snapshot it.
 */
const YEAR_PATH = currentYearAlbumPath();
const YEAR = YEAR_PATH.slice(1, -1);
const older = `${YEAR_PATH}06-15/`;
const newer = `${YEAR_PATH}12-31/`;
// The browser's locale decides the text; which album it names is the assertion
const title = (path: string): string => longDate(albumPathToDate(path));

function year(newerPublished: boolean): AlbumGalleryItem {
    return albumRecord({
        path: YEAR_PATH,
        parentPath: '/',
        itemName: YEAR,
        children: [
            albumRecord({ path: older, parentPath: YEAR_PATH, itemName: '06-15', published: true }),
            albumRecord({ path: newer, parentPath: YEAR_PATH, itemName: '12-31', published: newerPublished }),
        ],
    });
}

describe(LatestAlbumThumbnail, () => {
    beforeEach(() => {
        resetAlbumState();
    });

    it('shows the newest published album of the current year', async () => {
        seedLoadedAlbum(year(false));

        render(LatestAlbumThumbnail, {});

        await expect
            .element(page.getByRole('link', { name: title(older) }))
            .toHaveAttribute('href', older.slice(0, -1));
    });

    it('shows nothing until the year arrives, then follows it as it changes', async () => {
        render(LatestAlbumThumbnail, {});

        await expect.element(page.getByRole('heading', { name: 'Latest Album' })).not.toBeInTheDocument();

        seedLoadedAlbum(year(false));

        await expect.element(page.getByRole('link', { name: title(older) })).toBeVisible();

        seedLoadedAlbum(year(true));

        await expect.element(page.getByRole('link', { name: title(newer) })).toBeVisible();
        await expect.element(page.getByRole('link', { name: title(older) })).not.toBeInTheDocument();
    });
});
