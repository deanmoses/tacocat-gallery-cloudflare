import { beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from '$lib/test-support/render.svelte';
import YearAlbumPage from './YearAlbumPage.svelte';
import toAlbum from '$lib/models/impl/AlbumCreator';
import { resetAlbumState, seedLoadedAlbum } from '$lib/test-support/albumState';
import { albumRecord } from '$lib/test-support/records';

/**
 * A year's neighbours come from the root album's child list, read off the
 * store, so the page has to follow the root arriving after it has rendered.
 */
const ALBUM = toAlbum(albumRecord()); // 2001
const ROOT = albumRecord({
    path: '/',
    parentPath: '',
    itemName: '',
    children: ['2000', '2001', '2002'].map((year) =>
        albumRecord({ path: `/${year}/`, parentPath: '/', itemName: year }),
    ),
});

describe(YearAlbumPage, () => {
    beforeEach(() => {
        resetAlbumState();
    });

    // Years are paged through newest first, so prev is the later year
    it('links prev to the later year and next to the earlier one', async () => {
        seedLoadedAlbum(ROOT);

        render(YearAlbumPage, { album: ALBUM });

        await expect.element(page.getByRole('link', { name: '2002', exact: true })).toHaveAttribute('href', '/2002');
        await expect.element(page.getByRole('link', { name: '2000', exact: true })).toHaveAttribute('href', '/2000');
    });

    it('disables the buttons until the root arrives, then links them', async () => {
        render(YearAlbumPage, { album: ALBUM });

        await expect
            .element(page.getByRole('link', { name: 'Next', exact: true }))
            .toHaveAttribute('aria-disabled', 'true');

        seedLoadedAlbum(ROOT);

        await expect.element(page.getByRole('link', { name: '2000', exact: true })).toHaveAttribute('href', '/2000');
    });
});
