import { toast } from '@zerodevx/svelte-toast';
import { type MediaItemToUpload, UploadState } from '$lib/models/album';
import { albumState, getUploadsForAlbum } from '../AlbumState.svelte';
import {
    deduplicateMediaPaths,
    getParentFromPath,
    hasValidMediaExtension,
    isValidMediaPath,
} from '$lib/utils/galleryPathUtils';
import { albumLoadMachine } from '../AlbumLoadMachine.svelte';
import { findProcessedUploads } from '$lib/utils/uploadUtils';
import { validateMediaBatch } from '$lib/utils/mediaValidation';
import { fetchPresignedUrls, uploadToBucket } from '$lib/utils/mediaUpload';
import { type PresignedUpload, sanitizeMediaFilename } from 'tacocat-gallery-shared';
import { getProcessingTimeout } from '$lib/utils/fileFormats';
import { checkMediaErrors } from '$lib/utils/mediaErrors';

/**
 * Media item upload state machine
 */
class UploadMachine {
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

    uploadMediaItem(path: string, file: File, replaces?: string): void {
        void this.#uploadMediaItem(path, file, replaces); // invoke async service in fire-and-forget fashion
    }

    uploadMediaItems(albumPath: string, mediaItemsToUpload: MediaItemToUpload[]): void {
        void this.#uploadMediaItems(albumPath, mediaItemsToUpload); // invoke async service in fire-and-forget fashion
    }

    #uploadEnqueued(path: string, file: File): void {
        albumState.uploads.push({ file, path, status: UploadState.UPLOAD_NOT_STARTED });
    }

    #uploadStarted(path: string): void {
        const upload = albumState.uploads.find((entry) => entry.path === path);
        if (!upload) {
            console.warn(`Upload not found for path: ${path}`);
            return;
        }
        upload.status = UploadState.UPLOADING;
    }

    #uploadProcessing(path: string, versionId: string): void {
        const upload = albumState.uploads.find((entry) => entry.path === path);
        if (!upload) {
            console.warn(`Upload not found for path: ${path}`);
            return;
        }
        upload.status = UploadState.PROCESSING;
        upload.versionId = versionId;
    }

    #uploadErrored(path: string, errorMessage: string): void {
        console.error(`Error uploading [${path}]: ${errorMessage}`);
        toast.push(`Error uploading [${path}]: ${errorMessage}`);
        this.#uploadComplete(path);
    }

    #uploadProcessingFailed(path: string, errorMessage: string): void {
        console.error(`Processing failed for ${path}: ${errorMessage}`);
        toast.push(`Processing failed for ${path}: ${errorMessage}`, {
            duration: 8000,
            pausable: true,
        });
        this.#uploadComplete(path);
    }

    #uploadSkipped(path: string, skipMessage: string): void {
        console.error(`Skipping upload [${path}]: ${skipMessage}`);
        toast.push(`Skipping upload [${path}]: ${skipMessage}`);
    }

    #uploadComplete(path: string): void {
        // remove upload from list
        albumState.uploads = albumState.uploads.filter((upload) => upload.path !== path);
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

    /**
     * Upload one media item, replacing the item at `replaces` when there is one.
     *
     * @param path the media path the item will have
     * @param file A File object from browser's file picker
     */
    async #uploadMediaItem(path: string, file: File, replaces?: string): Promise<void> {
        try {
            const albumPath = getParentFromPath(path);
            this.#uploadEnqueued(path, file);
            await this.#uploadSingleMediaItem(albumPath, {
                file,
                path,
                ...(replaces === undefined ? {} : { replaces }),
            });
            await this.#pollForProcessedMediaItems(albumPath);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.#uploadErrored(path, msg);
        }
    }

    /** Upload a single media item after it's been enqueued */
    async #uploadSingleMediaItem(albumPath: string, mediaItemToUpload: MediaItemToUpload): Promise<void> {
        // Validate extension and path
        if (!hasValidMediaExtension(mediaItemToUpload.file.name)) {
            this.#uploadSkipped(mediaItemToUpload.path, `Invalid file type: [${mediaItemToUpload.file.name}]`);
            this.#uploadComplete(mediaItemToUpload.path);
            return;
        }
        if (!isValidMediaPath(mediaItemToUpload.path)) {
            this.#uploadSkipped(mediaItemToUpload.path, `Invalid media path: [${mediaItemToUpload.path}]`);
            this.#uploadComplete(mediaItemToUpload.path);
            return;
        }

        // Validate media content
        const validationResult = await validateMediaBatch([mediaItemToUpload]);
        if (validationResult.invalid.length > 0) {
            this.#uploadSkipped(mediaItemToUpload.path, 'Invalid or corrupted media file');
            this.#uploadComplete(mediaItemToUpload.path);
            return;
        }

        // Get presigned URL and upload
        const presignedResult = await fetchPresignedUrls(albumPath, [presignEntry(mediaItemToUpload)]);
        if (!presignedResult.success) {
            throw new Error(presignedResult.error);
        }
        const presigned = presignedResult.uploads[mediaItemToUpload.path];
        if (presigned === undefined) {
            throw new Error('No presigned URL for media item');
        }
        await this.#uploadMediaItemViaPresignedUrl(mediaItemToUpload, presigned);
    }

    async #uploadMediaItems(albumPath: string, mediaItemsToUpload: MediaItemToUpload[]): Promise<void> {
        // Narrowed as validation rejects items, so a failure cleans up only the ones still in play
        let itemsToUpload = mediaItemsToUpload;
        try {
            if (itemsToUpload.length === 0) throw new Error('No media to upload');

            // Validate file extensions and media paths
            itemsToUpload = itemsToUpload.filter((mediaItemToUpload) => {
                if (!hasValidMediaExtension(mediaItemToUpload.file.name)) {
                    this.#uploadSkipped(mediaItemToUpload.path, `Invalid file type: [${mediaItemToUpload.file.name}]`);
                    return false;
                }
                if (!isValidMediaPath(mediaItemToUpload.path)) {
                    this.#uploadSkipped(mediaItemToUpload.path, `Invalid media path: [${mediaItemToUpload.path}]`);
                    return false;
                }
                return true;
            });
            if (itemsToUpload.length === 0) return;

            // Validate media content (checks file size > 0 and that browser can load any browser-loadable media)
            const validationResult = await validateMediaBatch(itemsToUpload);
            for (const path of validationResult.invalid) {
                this.#uploadSkipped(path, 'Invalid or corrupted media file');
            }
            itemsToUpload = validationResult.valid;
            if (itemsToUpload.length === 0) return;

            // Get presigned URLs
            const presignedResult = await fetchPresignedUrls(albumPath, itemsToUpload.map(presignEntry));
            if (!presignedResult.success) {
                throw new Error(presignedResult.error);
            }
            const presignedUploads = presignedResult.uploads;

            // Enqueue uploads
            for (const mediaItemToUpload of itemsToUpload) {
                this.#uploadEnqueued(mediaItemToUpload.path, mediaItemToUpload.file);
            }

            // Put every file to its URL in parallel
            const mediaUploads: Promise<void>[] = [];
            for (const mediaItemToUpload of itemsToUpload) {
                const presigned = presignedUploads[mediaItemToUpload.path];
                if (presigned === undefined) {
                    this.#uploadErrored(mediaItemToUpload.path, `No presigned URL for media`);
                    continue;
                }
                mediaUploads.push(this.#uploadMediaItemViaPresignedUrl(mediaItemToUpload, presigned));
            }
            await Promise.allSettled(mediaUploads);
            await this.#pollForProcessedMediaItems(albumPath);
        } catch (error) {
            // Clean up any uploads that were enqueued before the failure
            for (const mediaItemToUpload of itemsToUpload) {
                this.#uploadComplete(mediaItemToUpload.path);
            }
            toast.push(String(error));
        }
    }

    async #uploadMediaItemViaPresignedUrl(
        mediaItemToUpload: MediaItemToUpload,
        presigned: PresignedUpload,
    ): Promise<void> {
        this.#uploadStarted(mediaItemToUpload.path);
        const result = await uploadToBucket(mediaItemToUpload.file, presigned.url);
        if (result.success) {
            console.log(`Uploaded [${mediaItemToUpload.path}] as versionId [${presigned.versionId}]`);
            this.#uploadProcessing(mediaItemToUpload.path, presigned.versionId);
        } else {
            this.#uploadErrored(mediaItemToUpload.path, result.error);
        }
    }

    /**
     * Poll the server, checking to see if the media have made it into the album
     */
    async #pollForProcessedMediaItems(albumPath: string): Promise<void> {
        const POLL_INTERVAL_MS = 1500;

        // Calculate max poll attempts based on the slowest-processing file type
        const uploads = getUploadsForAlbum(albumPath);
        const maxTimeoutMs = Math.max(...uploads.map((upload) => getProcessingTimeout(upload.path)));
        const maxPollAttempts = Math.ceil(maxTimeoutMs / POLL_INTERVAL_MS);

        let processingComplete: boolean;
        let pollAttemptCount = 0;
        do {
            await sleep(POLL_INTERVAL_MS);
            processingComplete = await this.#areMediaProcessed(albumPath);
            pollAttemptCount++;
        } while (!processingComplete && pollAttemptCount < maxPollAttempts);
        console.log(`Media have been processed. Loop count: [${pollAttemptCount}]`);

        // If polling timed out with media still processing, clear them from UI and notify user
        if (processingComplete) return;
        const remaining = getUploadsForAlbum(albumPath);
        for (const upload of remaining) {
            this.#uploadComplete(upload.path);
        }
        toast.push('Some media are still processing. Refresh to see them when ready.');
    }

    async #areMediaProcessed(albumPath: string): Promise<boolean> {
        const uploads = getUploadsForAlbum(albumPath);
        if (uploads.length === 0) return true;
        try {
            // Check for processing errors (e.g., video transcoding failures)
            const paths = uploads.map((upload) => upload.path);
            const errorResult = await checkMediaErrors(paths);
            if (errorResult.success && errorResult.errors) {
                for (const [path, errorMessage] of Object.entries(errorResult.errors)) {
                    this.#uploadProcessingFailed(path, errorMessage);
                }
            }

            // Check which uploads have completed successfully
            await albumLoadMachine.fetchFromServer(albumPath);
            const album = albumState.albums.get(albumPath)?.album;
            if (!album) throw new Error('album not loaded');

            const versions = new Set(album.media.map((media) => media.versionId));
            const { processed, allProcessed } = findProcessedUploads(uploads, (versionId) => versions.has(versionId));

            for (const path of processed) {
                this.#uploadComplete(path);
            }

            return allProcessed;
        } catch (error) {
            console.error(`Error checking if media are processed`, error);
            return false;
        }
    }
}
export const uploadMachine = new UploadMachine();

/** What the server is told about an upload: where it goes, and for a replacement, what it replaces */
function presignEntry(item: MediaItemToUpload): { path: string; replaces?: string } {
    return { path: item.path, ...(item.replaces === undefined ? {} : { replaces: item.replaces }) };
}

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

//
// Utils for working with machine
//

export function getSanitizedFiles(files: FileList | File[], albumPath: string): MediaItemToUpload[] {
    // Create sanitized paths for all files
    const filesWithPaths: MediaItemToUpload[] = [];
    for (const file of files) {
        const path = albumPath + sanitizeMediaFilename(file.name);
        filesWithPaths.push({ file, path });
    }

    // Deduplicate paths
    // e.g., my-photo.jpg and my_photo.jpg both become my_photo.jpg, and therefore one needs to become my_photo_1.jpg
    const originalPaths = filesWithPaths.map((item) => item.path);
    const deduplicatedPaths = deduplicateMediaPaths(originalPaths);

    // Build result with deduplicated paths, which come back one per original path in the same order
    return filesWithPaths.map((item, index) => ({
        file: item.file,
        path: deduplicatedPaths[index] ?? item.path,
    }));
}
