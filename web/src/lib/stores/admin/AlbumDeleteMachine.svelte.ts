import { DeleteStatus } from '$lib/models/album';
import { callApi, failureMessage } from '$lib/utils/adminApi';
import { API, isAlbumPath, parentPathOf } from '@tacocat-gallery/shared';
import { toast } from '@zerodevx/svelte-toast';
import { albumLoadMachine } from '../AlbumLoadMachine.svelte';
import { albumState } from '../AlbumState.svelte';

/**
 * Album delete state machine
 */
class AlbumDeleteMachine {
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

    deleteAlbum(albumPath: string): void {
        void this.#deleteAlbum(albumPath); // call async logic in a fire-and-forget manner
    }

    #deleteStarted(albumPath: string): void {
        albumState.albumDeletes.set(albumPath, {
            status: DeleteStatus.IN_PROGRESS,
        });
    }

    #success(albumPath: string): void {
        console.log(`Album [${albumPath}] deleted`);
        albumState.albumDeletes.delete(albumPath);
        toast.push(`Album [${albumPath}] deleted`);
    }

    #error(albumPath: string, errorMessage: string): void {
        albumState.albumDeletes.delete(albumPath);
        toast.push(`Error deleting album: ${errorMessage}`);
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

    async #deleteAlbum(albumPath: string): Promise<void> {
        try {
            if (!isAlbumPath(albumPath)) throw new Error(`Invalid album path [${albumPath}]`);
            this.#deleteStarted(albumPath);
            const response = await callApi(API.deleteAlbum, albumPath);
            if (!response.ok) {
                throw new Error(await failureMessage(response));
            }
            await albumLoadMachine.removeFromMemoryAndDisk(albumPath);
            await albumLoadMachine.fetchFromServer(parentPathOf(albumPath)); // reload parent album
            this.#success(albumPath);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.#error(albumPath, msg);
        }
    }
}
export const albumDeleteMachine = new AlbumDeleteMachine();
