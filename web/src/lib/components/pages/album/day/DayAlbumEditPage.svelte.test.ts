import { beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from '$lib/test-support/render.svelte';
import DayAlbumEditPage from './DayAlbumEditPage.svelte';
import { resetAlbumState } from '$lib/test-support/albumState';
import { dayAlbum, imageRecord, mediaPath, uploadEntry } from '$lib/test-support/records';
import { albumState } from '$lib/stores/AlbumState.svelte';
import { UploadState } from '$lib/models/album';

describe(DayAlbumEditPage, () => {
    beforeEach(() => {
        resetAlbumState();
    });

    // An upload's tile is the height of the item it becomes, which has no summary
    it('shows each upload where the album will put it, with no status under it', async () => {
        const album = dayAlbum(['b', 'd'].map((name) => imageRecord({ path: mediaPath(name), itemName: name })));
        albumState.uploads = ['c', 'a'].map((name) =>
            uploadEntry({ path: mediaPath(name), status: UploadState.UPLOADING }),
        );

        render(DayAlbumEditPage, { album });

        await expect
            .poll(() =>
                page
                    .getByTestId('thumbnail')
                    .elements()
                    .map((thumbnail) => thumbnail.textContent.trim().replaceAll(/\s+/gv, ' ')),
            )
            .toStrictEqual(['a', 'B', 'c', 'D']);
    });
});
