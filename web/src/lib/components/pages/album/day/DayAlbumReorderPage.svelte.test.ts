import { type SvelteToastOptions, toast } from '@zerodevx/svelte-toast';
import { beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from '$lib/test-support/render.svelte';
import DayAlbumReorderPage from './DayAlbumReorderPage.svelte';
import { ReorderStatus } from '$lib/models/album';
import toAlbum from '$lib/models/impl/AlbumCreator';
import { albumState } from '$lib/stores/AlbumState.svelte';
import { resetAlbumState } from '$lib/test-support/albumState';
import { fakeServer, jsonResponse } from '$lib/test-support/http';
import { albumRecord, imageRecord, mediaPath } from '$lib/test-support/records';

const ALBUM_PATH = '/2001/12-31/';
const ORDER_ROUTE = '/api/album-order/2001/12-31/';
const ALBUM_ROUTE = '/api/album/2001/12-31/';

function photo(itemName: string): ReturnType<typeof imageRecord> {
    return imageRecord({ path: mediaPath(itemName), itemName, title: `Photo ${itemName}` });
}

function record(itemNames: string[], reordered = false): ReturnType<typeof albumRecord> {
    return albumRecord({
        path: ALBUM_PATH,
        parentPath: '/2001/',
        itemName: '12-31',
        ...(reordered && { order: true }),
        children: itemNames.map(photo),
    });
}

/**
 * Picks a photo up, moves it one place along and drops it, with the keyboard, which does what a drag does. The photo is
 * focused as a Tab would; a click would not, since the library holds the pointer for a drag.
 */
async function moveRight(title: string): Promise<void> {
    (page.getByRole('listitem', { name: title }).element() as HTMLElement).focus();
    await userEvent.keyboard(' ');
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard(' ');
}

/** What the toasts pushed so far say */
function toasts(): (string | undefined)[] {
    let messages: (string | undefined)[] = [];
    const unsubscribe = toast.subscribe((pushed: SvelteToastOptions[]) => {
        messages = pushed.map((each) => each.msg);
    });
    unsubscribe();
    return messages;
}

// Named Save* once there is something to save
const save = page.getByRole('button', { name: 'Save', exact: false });

describe(DayAlbumReorderPage, () => {
    beforeEach(() => {
        resetAlbumState();
        // Every spec pushes to the one toast store, and a toast outlives the spec that pushed it
        toast.pop(0);
        albumState.albumReorders.set(ALBUM_PATH, { status: ReorderStatus.REORDERING });
    });

    it('saves the order the photos were moved into, says so, then leaves reordering', async () => {
        const server = fakeServer();
        server.put(ORDER_ROUTE, new Response(null, { status: 204 }));
        server.get(ALBUM_ROUTE, jsonResponse(record(['b', 'a', 'c'], true)));
        render(DayAlbumReorderPage, { album: toAlbum(record(['a', 'b', 'c'])) });

        await expect.element(save).toBeDisabled();

        await moveRight('Photo a');
        await userEvent.click(save);

        await expect.poll(() => albumState.albumReorders.has(ALBUM_PATH)).toBe(false);
        expect(server.calls[0]).toStrictEqual({
            method: 'PUT',
            pathname: ORDER_ROUTE,
            body: { itemNames: ['b', 'a', 'c'] },
        });
        expect(toasts()).toStrictEqual(['Order saved']);
    });

    // An album in name order would otherwise become one in an order of its own that happens to be the same, and later
    // uploads would go at the end instead of among the rest
    it('has nothing to save once the photos are back where they started', async () => {
        render(DayAlbumReorderPage, { album: toAlbum(record(['a', 'b', 'c'])) });

        await moveRight('Photo a');

        await expect.element(save).toBeEnabled();

        await moveRight('Photo b');

        await expect.element(save).toBeDisabled();
    });

    it('offers to put an album in an order of its own back in name order', async () => {
        const server = fakeServer();
        server.delete(ORDER_ROUTE, new Response(null, { status: 204 }));
        server.get(ALBUM_ROUTE, jsonResponse(record(['a', 'b', 'c'])));
        render(DayAlbumReorderPage, { album: toAlbum(record(['c', 'a', 'b'], true)) });

        await userEvent.click(page.getByRole('button', { name: 'Reset order' }));

        await expect.poll(() => albumState.albumReorders.has(ALBUM_PATH)).toBe(false);
        expect(server.calls[0]).toMatchObject({ method: 'DELETE', pathname: ORDER_ROUTE });
        expect(toasts()).toStrictEqual(['Order reset']);
    });

    it('has no order to reset in an album in name order', async () => {
        render(DayAlbumReorderPage, { album: toAlbum(record(['a', 'b', 'c'])) });

        await expect.element(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
        await expect.element(page.getByRole('button', { name: 'Reset order' })).not.toBeInTheDocument();
    });

    it('leaves reordering on cancel without asking the server anything', async () => {
        const server = fakeServer();
        render(DayAlbumReorderPage, { album: toAlbum(record(['a', 'b', 'c'])) });

        await moveRight('Photo a');
        await userEvent.click(page.getByRole('button', { name: 'Cancel' }));

        expect(albumState.albumReorders.has(ALBUM_PATH)).toBe(false);
        expect(server.calls).toStrictEqual([]);
    });

    // Leaving mid-save would bring the page back into reordering if the save then failed
    it('cannot be left or reset while the order is saving', async () => {
        albumState.albumReorders.set(ALBUM_PATH, { status: ReorderStatus.SAVING });
        render(DayAlbumReorderPage, { album: toAlbum(record(['c', 'a', 'b'], true)) });

        await expect.element(page.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        await expect.element(page.getByRole('button', { name: 'Reset order' })).toBeDisabled();
    });

    it('stays reordering, with the order as moved, when the server refuses it', async () => {
        const server = fakeServer();
        server.put(ORDER_ROUTE, jsonResponse({ errorMessage: 'Album not found' }, 404));
        render(DayAlbumReorderPage, { album: toAlbum(record(['a', 'b', 'c'])) });

        await moveRight('Photo a');
        await userEvent.click(save);

        await expect.poll(() => albumState.albumReorders.get(ALBUM_PATH)?.status).toBe(ReorderStatus.REORDERING);
        await expect.element(save).toBeEnabled();
        expect(toasts()).toStrictEqual(['Error saving order: Album not found']);
    });
});
