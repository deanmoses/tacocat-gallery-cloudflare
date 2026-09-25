import { RenameStatus } from '$lib/models/album';
import { renameAlbumUrl } from '$lib/utils/config';
import { adminApi, failureMessage } from '$lib/utils/adminApi';
import { getNameFromPath, getParentFromPath, isValidDayAlbumPath } from '$lib/utils/galleryPathUtils';
import { toast } from '@zerodevx/svelte-toast';
import { albumLoadMachine } from '../AlbumLoadMachine.svelte';
import { albumState } from '../AlbumState.svelte';

/**
 * Album rename state machine
 */
class AlbumRenameMachine {
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

    renameDayAlbum(oldAlbumPath: string, newAlbumPath: string): void {
        void this.#renameDayAlbum(oldAlbumPath, newAlbumPath); // call async logic in a fire-and-forget manner
    }

    #renameStarted(oldPath: string, newPath: string): void {
        albumState.albumRenames.set(oldPath, {
            oldPath,
            newPath,
            status: RenameStatus.IN_PROGRESS,
        });
    }

    #renamed(oldAlbumPath: string): void {
        const rename = albumState.albumRenames.get(oldAlbumPath);
        if (rename) {
            albumState.albumRenames.set(oldAlbumPath, { ...rename, status: RenameStatus.RENAMED });
        }
    }

    #success(oldAlbumPath: string): void {
        albumState.albumRenames.delete(oldAlbumPath);
    }

    #error(oldAlbumPath: string, newAlbumPath: string, errorMessage: string): void {
        console.error(`Error renaming album [${oldAlbumPath}] to [${newAlbumPath}]: ${errorMessage}`);
        albumState.albumRenames.delete(oldAlbumPath);
        toast.push(`Error renaming album: ${errorMessage}`);
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

    async #renameDayAlbum(oldAlbumPath: string, newAlbumPath: string): Promise<void> {
        try {
            if (!isValidDayAlbumPath(oldAlbumPath)) throw new Error(`Invalid old album path [${oldAlbumPath}]`);
            if (!isValidDayAlbumPath(newAlbumPath)) throw new Error(`Invalid new album path [${newAlbumPath}]`);
            const album = albumState.albums.get(oldAlbumPath)?.album;
            if (!album) throw new Error(`Album [${oldAlbumPath}] not loaded`);
            const newName = getNameFromPath(newAlbumPath);
            console.log(`Renaming album [${oldAlbumPath}] to [${newName}]...`);
            this.#renameStarted(oldAlbumPath, newAlbumPath);
            const response = await adminApi.post(renameAlbumUrl(oldAlbumPath), { newName });
            if (!response.ok) {
                throw new Error(await failureMessage(response));
            }
            // The page at the old path moves to the new one on seeing this, while the parent is re-read
            this.#renamed(oldAlbumPath);
            await albumLoadMachine.fetchFromServer(getParentFromPath(oldAlbumPath));
            void albumLoadMachine.removeFromMemoryAndDisk(oldAlbumPath);
            this.#success(oldAlbumPath);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.#error(oldAlbumPath, newAlbumPath, msg);
        }
    }
}
export const albumRenameMachine = new AlbumRenameMachine();
