import type { Draft, DraftContent } from '$lib/models/draft';
import { DraftStatus } from '$lib/models/draft';
import { albumLoadMachine } from '../AlbumLoadMachine.svelte';
import { API, isMediaPath, parentPathOf, parsePath } from '@tacocat-gallery/shared';
import toAlbum from '$lib/models/impl/AlbumCreator';
import type { AlbumGalleryItem } from '$lib/models/impl/server';
import { callApi, failureMessage } from '$lib/utils/adminApi';
import { toast } from '@zerodevx/svelte-toast';
import { albumState } from '../AlbumState.svelte';

const initialState: Draft = {
    status: DraftStatus.NO_CHANGES,
    path: '/1800', // TODO FIX THIS
    content: {},
};

/**
 * Store of the draft changes to an album or a image
 *
 * Unlike the Redux version, which held a draft per album, this
 * only holds the one single draft that's currently being edited.
 * The Redux version was over-engineered; I'm not getting into
 * offline editing and bulk saving drafts when the user goes back online.
 */
class DraftMachine {
    /**
     * Private writable store holding the draft
     */
    #draft: Draft = $state(initialState);

    /**
     * Public read-only store of the draft
     */
    readonly draft: Draft = $derived(this.#draft);

    /**
     * Public read-only copy of draft status
     */
    readonly status: DraftStatus | undefined = $derived(this.#draft.status);

    readonly okToNavigate: boolean = $derived(
        this.#draft.status !== DraftStatus.UNSAVED_CHANGES && this.#draft.status !== DraftStatus.SAVING,
    );

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

    /**
     * Initialize or reset the draft state with the given path
     * @param path the URL path, TODO make this an image / album path
     */
    init(path: string): void {
        console.log(`Init draft [${path}]`);
        if (parsePath(path) === null) throw new Error(`Invalid path [${path}]`);
        this.#draft = { ...initialState, path };
    }

    /**
     * Set the title of the current draft
     */
    setTitle(title: string): void {
        this.#updateContent((content) => {
            content.title = title;
        });
    }

    /**
     * Set the description of the current draft
     */
    setDescription(description: string): void {
        this.#updateContent((content) => {
            content.description = description;
        });
    }

    /**
     * Set the album summary of the current draft
     */
    setSummary(summary: string): void {
        this.#updateContent((content) => {
            content.summary = summary;
        });
    }

    /**
     * Set the published status of the current draft
     */
    setPublished(published: boolean): void {
        this.#updateContent((content) => {
            content.published = published;
        });
    }

    /**
     * Throw away all draft edits; reset the store
     */
    cancel(): void {
        console.log('canceling draft:', $state.snapshot(this.#draft));
        this.#draft = initialState;
    }

    /**
     * Save the current draft to the server
     */
    save(): void {
        void this.#save(this.#draft); // call async logic in a fire-and-forget manner
    }

    #saveStart(): void {
        this.#setStatus(DraftStatus.SAVING);
    }

    #saveError(errorMessage?: string): void {
        this.#setStatus(DraftStatus.ERRORED);
        if (errorMessage !== undefined && errorMessage !== '') toast.push(errorMessage);
    }

    #saveSuccess(): void {
        this.#setStatus(DraftStatus.SAVED);
    }

    #clearSaveSuccess(): void {
        // Only clear saved status if the status is actually still saved
        if (this.#draft.status === DraftStatus.SAVED) {
            console.log('DraftStore: in timeout, setting draft status to NO_CHANGES');
            this.#setStatus(DraftStatus.NO_CHANGES);
        } else {
            console.log('Draft status was not still SAVED');
        }
    }

    /**
     * Change the status of the draft
     */
    #setStatus(newStatus: DraftStatus): void {
        this.#draft = { ...this.#draft, status: newStatus };
    }

    /**
     * Update the content of the draft
     */
    #updateContent(applyChangesToDraftContent: (draftContent: DraftContent) => void): void {
        const content = { ...this.#draft.content };
        applyChangesToDraftContent(content);
        const newState: Draft = { ...this.#draft, status: DraftStatus.UNSAVED_CHANGES, content };
        console.log(`Update draft [${newState.path}]:`, newState.content);
        this.#draft = newState;
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

    async #save(draft: Draft): Promise<void> {
        if (!draft.path || !draft.content) {
            console.error(`Error saving [${draft.path}]: nothing to save!`);
            this.#saveError();
        } else {
            console.log(`Saving draft [${draft.path}]:`, draft.content);
            this.#saveStart();
            try {
                const response = isMediaPath(draft.path)
                    ? await callApi(API.updateMedia, draft.path, draft.content)
                    : await callApi(API.updateAlbum, draft.path, draft.content);
                if (!response.ok) {
                    throw new Error(await failureMessage(response));
                }
            } catch (error) {
                console.error(`Error saving [${draft.path}]: ${String(error)}`);
                this.#saveError(error instanceof Error ? error.message : 'Error saving');
                return;
            }

            // UPDATE CLIENT STATE
            // Update both the album in memory and on the browser's local filesystem

            // The album is rebuilt from a copy of its JSON rather than edited
            // in place: AlbumState's map signals its readers only when the
            // entry is a new object, and the old album may still be on screen.
            const albumPath = isMediaPath(draft.path) ? parentPathOf(draft.path) : draft.path;
            const albumEntry = albumState.albums.get(albumPath);
            if (!albumEntry?.album) throw new Error(`Did not find album [${albumPath}] in memory`);
            const { children, ...json } = albumEntry.album.json;
            const copy: AlbumGalleryItem = { ...json };
            if (children) copy.children = children.map((child) => (child.path === draft.path ? { ...child } : child));
            const album = toAlbum(copy);
            const edited = isMediaPath(draft.path) ? album.getMedia(draft.path) : album;
            if (!edited) throw new Error(`Did not find media item [${draft.path}] in album [${albumPath}]`);
            // The setters write the edit into the copied JSON, which is what goes to disk
            Object.assign(edited, draft.content);
            albumLoadMachine.updateAlbumEntry({ ...albumEntry, album });

            this.#saveSuccess();

            // Clear the saved status after a while
            console.log('DraftStore: before save clear timeout');
            setTimeout(() => {
                console.log('DraftStore: save clear timed out');
                this.#clearSaveSuccess();
            }, 4000);
        }
    }
}
export const draftMachine = new DraftMachine();
