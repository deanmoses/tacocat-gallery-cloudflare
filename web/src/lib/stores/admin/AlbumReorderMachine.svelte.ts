import { toast } from '@zerodevx/svelte-toast';
import { ReorderStatus } from '$lib/models/album';
import { callApi, failureMessage } from '$lib/utils/adminApi';
import { albumLoadMachine } from '../AlbumLoadMachine.svelte';
import { albumState } from '../AlbumState.svelte';
import { API } from '@tacocat-gallery/shared';

/**
 * Album reorder state machine
 */
class AlbumReorderMachine {
    //
    // STATE TRANSITION METHODS
    // These mutate the store's state.
    //
    // Characteristics:
    //  - These are the ONLY way to update this store's state.
    //    These should be the only public methods on this store.
    //  - These ONLY update state.
    //    If they have to do any work, like making a server call, they invoke it in an
    //    event-like fire-and-forget fashion, meaning invoke async methods *without* await.
    //  - These are synchronous.
    //    They expectation is that they return near-instantly.
    //  - These return void.
    //    To read this store's state, use one of the public $derived() fields
    //

    startReordering(albumPath: string): void {
        albumState.albumReorders.set(albumPath, { status: ReorderStatus.REORDERING });
    }

    cancelReordering(albumPath: string): void {
        albumState.albumReorders.delete(albumPath);
    }

    /**
     * Put the album's media in the order of `itemNames`, or back in name order when that is null
     */
    saveOrder(albumPath: string, itemNames: string[] | null): void {
        albumState.albumReorders.set(albumPath, { status: ReorderStatus.SAVING });
        void this.#saveOrder(albumPath, itemNames); // call async logic in a fire-and-forget manner
    }

    #success(albumPath: string, reset: boolean): void {
        albumState.albumReorders.delete(albumPath);
        toast.push(reset ? 'Order reset' : 'Order saved');
    }

    /** Back to dragging, with the order the admin had, so they can try again */
    #error(albumPath: string, errorMessage: string): void {
        console.error(`Error saving the order of album [${albumPath}]: ${errorMessage}`);
        albumState.albumReorders.set(albumPath, { status: ReorderStatus.REORDERING });
        toast.push(`Error saving order: ${errorMessage}`);
    }

    //
    // SERVICE METHODS
    // These 'do work', like making a server call.
    //
    // Characteristics:
    //  - These are private, meant to only be called by STATE TRANSITION METHODS
    //  - These don't mutate state directly; rather, they call STATE TRANSITION METHODS to do it
    //  - These are generally async
    //  - These don't return values; they return void or Promise<void>
    //

    async #saveOrder(albumPath: string, itemNames: string[] | null): Promise<void> {
        try {
            const response =
                itemNames === null
                    ? await callApi(API.resetAlbumOrder, albumPath)
                    : await callApi(API.orderAlbum, albumPath, { itemNames });
            if (!response.ok) {
                throw new Error(await failureMessage(response));
            }
            await albumLoadMachine.fetchFromServer(albumPath);
            this.#success(albumPath, itemNames === null);
        } catch (error) {
            this.#error(albumPath, error instanceof Error ? error.message : String(error));
        }
    }
}
export const albumReorderMachine = new AlbumReorderMachine();
