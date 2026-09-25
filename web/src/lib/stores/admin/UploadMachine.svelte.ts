import { toast } from '@zerodevx/svelte-toast';
import { type MediaItemToUpload, UploadState } from '$lib/models/album';
import { albumState, getUploadsForAlbum } from '../AlbumState.svelte';
import {
    deduplicateMediaPaths,
    getParentFromPath,
    hasValidMediaExtension,
    isValidMediaPath,
    sanitizeMediaFilename,
} from '$lib/utils/galleryPathUtils';
import { albumLoadMachine } from '../AlbumLoadMachine.svelte';
import { findProcessedUploads } from '$lib/utils/uploadUtils';
import { validateMediaBatch } from '$lib/utils/mediaValidation';
import { fetchPresignedUrls, uploadToS3 } from '$lib/utils/s3Upload';
import type { PresignedUpload } from 'tacocat-gallery-shared';
import { getMediaPath, getProcessingTimeout } from '$lib/utils/fileFormats';
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

    uploadMediaItem(uploadPath: string, file: File, previousVersionId?: string, replaces?: string): void {
        void this.#uploadMediaItem(uploadPath, file, previousVersionId, replaces); // invoke async service in fire-and-forget fashion
    }

    uploadMediaItems(albumPath: string, mediaItemsToUpload: MediaItemToUpload[]): void {
        void this.#uploadMediaItems(albumPath, mediaItemsToUpload); // invoke async service in fire-and-forget fashion
    }

    #uploadEnqueued(uploadPath: string, file: File, previousVersionId?: string): void {
        albumState.uploads.push({
            file,
            uploadPath,
            mediaPath: getMediaPath(uploadPath),
            status: UploadState.UPLOAD_NOT_STARTED,
            ...(previousVersionId === undefined ? {} : { previousVersionId }),
        });
    }

    #uploadStarted(uploadPath: string): void {
        const upload = albumState.uploads.find((entry) => entry.uploadPath === uploadPath);
        if (!upload) {
            console.warn(`Upload not found for path: ${uploadPath}`);
            return;
        }
        upload.status = UploadState.UPLOADING;
    }

    #uploadProcessing(uploadPath: string, versionId: string): void {
        const upload = albumState.uploads.find((entry) => entry.uploadPath === uploadPath);
        if (!upload) {
            console.warn(`Upload not found for path: ${uploadPath}`);
            return;
        }
        upload.status = UploadState.PROCESSING;
        upload.versionId = versionId;
    }

    #uploadErrored(uploadPath: string, errorMessage: string): void {
        console.error(`Error uploading [${uploadPath}]: ${errorMessage}`);
        toast.push(`Error uploading [${uploadPath}]: ${errorMessage}`);
        this.#uploadComplete(uploadPath);
    }

    #uploadProcessingFailed(uploadPath: string, errorMessage: string): void {
        console.error(`Processing failed for ${uploadPath}: ${errorMessage}`);
        toast.push(`Processing failed for ${uploadPath}: ${errorMessage}`, {
            duration: 8000,
            pausable: true,
        });
        this.#uploadComplete(uploadPath);
    }

    #uploadSkipped(uploadPath: string, skipMessage: string): void {
        console.error(`Skipping upload [${uploadPath}]: ${skipMessage}`);
        toast.push(`Skipping upload [${uploadPath}]: ${skipMessage}`);
    }

    #uploadComplete(uploadPath: string): void {
        // remove upload from list
        albumState.uploads = albumState.uploads.filter((upload) => upload.uploadPath !== uploadPath);
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
     * Upload the specified single media item.  Replaces media item at the specified path, if it exists.
     *
     * @param uploadPath path to upload to
     * @param file A File object from browser's file picker
     * @param previousVersionId For replacements: versionId of the media item being replaced
     * @param replaces For replacements: path of the media item being replaced
     */
    async #uploadMediaItem(
        uploadPath: string,
        file: File,
        previousVersionId?: string,
        replaces?: string,
    ): Promise<void> {
        try {
            const albumPath = getParentFromPath(uploadPath);
            this.#uploadEnqueued(uploadPath, file, previousVersionId);
            await this.#uploadSingleMediaItem(albumPath, {
                file,
                uploadPath,
                ...(replaces === undefined ? {} : { replaces }),
            });
            await this.#pollForProcessedMediaItems(albumPath);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.#uploadErrored(uploadPath, msg);
        }
    }

    /** Upload a single media item after it's been enqueued */
    async #uploadSingleMediaItem(albumPath: string, mediaItemToUpload: MediaItemToUpload): Promise<void> {
        // Validate extension and path
        if (!hasValidMediaExtension(mediaItemToUpload.file.name)) {
            this.#uploadSkipped(mediaItemToUpload.uploadPath, `Invalid file type: [${mediaItemToUpload.file.name}]`);
            this.#uploadComplete(mediaItemToUpload.uploadPath);
            return;
        }
        if (!isValidMediaPath(mediaItemToUpload.uploadPath)) {
            this.#uploadSkipped(mediaItemToUpload.uploadPath, `Invalid media path: [${mediaItemToUpload.uploadPath}]`);
            this.#uploadComplete(mediaItemToUpload.uploadPath);
            return;
        }

        // Validate media content
        const validationResult = await validateMediaBatch([mediaItemToUpload]);
        if (validationResult.invalid.length > 0) {
            this.#uploadSkipped(mediaItemToUpload.uploadPath, 'Invalid or corrupted media file');
            this.#uploadComplete(mediaItemToUpload.uploadPath);
            return;
        }

        // Get presigned URL and upload
        const presignedResult = await fetchPresignedUrls(albumPath, [presignEntry(mediaItemToUpload)]);
        if (!presignedResult.success) {
            throw new Error(presignedResult.error);
        }
        const presigned = presignedResult.uploads[mediaItemToUpload.uploadPath];
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
                    this.#uploadSkipped(
                        mediaItemToUpload.uploadPath,
                        `Invalid file type: [${mediaItemToUpload.file.name}]`,
                    );
                    return false;
                }
                if (!isValidMediaPath(mediaItemToUpload.uploadPath)) {
                    this.#uploadSkipped(
                        mediaItemToUpload.uploadPath,
                        `Invalid media path: [${mediaItemToUpload.uploadPath}]`,
                    );
                    return false;
                }
                return true;
            });
            if (itemsToUpload.length === 0) return;

            // Validate media content (checks file size > 0 and that browser can load any browser-loadable media)
            const validationResult = await validateMediaBatch(itemsToUpload);
            for (const uploadPath of validationResult.invalid) {
                this.#uploadSkipped(uploadPath, 'Invalid or corrupted media file');
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
                this.#uploadEnqueued(
                    mediaItemToUpload.uploadPath,
                    mediaItemToUpload.file,
                    mediaItemToUpload.previousVersionId,
                );
            }

            // Upload to S3 in parallel
            const mediaUploads: Promise<void>[] = [];
            for (const mediaItemToUpload of itemsToUpload) {
                const presigned = presignedUploads[mediaItemToUpload.uploadPath];
                if (presigned === undefined) {
                    this.#uploadErrored(mediaItemToUpload.uploadPath, `No presigned URL for media`);
                    continue;
                }
                mediaUploads.push(this.#uploadMediaItemViaPresignedUrl(mediaItemToUpload, presigned));
            }
            await Promise.allSettled(mediaUploads);
            await this.#pollForProcessedMediaItems(albumPath);
        } catch (error) {
            // Clean up any uploads that were enqueued before the failure
            for (const mediaItemToUpload of itemsToUpload) {
                this.#uploadComplete(mediaItemToUpload.uploadPath);
            }
            toast.push(String(error));
        }
    }

    async #uploadMediaItemViaPresignedUrl(
        mediaItemToUpload: MediaItemToUpload,
        presigned: PresignedUpload,
    ): Promise<void> {
        this.#uploadStarted(mediaItemToUpload.uploadPath);
        const result = await uploadToS3(mediaItemToUpload.file, presigned.url);
        if (result.success) {
            console.log(`Uploaded [${mediaItemToUpload.uploadPath}] as versionId [${presigned.versionId}]`);
            this.#uploadProcessing(mediaItemToUpload.uploadPath, presigned.versionId);
        } else {
            this.#uploadErrored(mediaItemToUpload.uploadPath, result.error);
        }
    }

    /**
     * Poll the server, checking to see if the media have made it into the album
     */
    async #pollForProcessedMediaItems(albumPath: string): Promise<void> {
        const POLL_INTERVAL_MS = 1500;

        // Calculate max poll attempts based on the slowest-processing file type
        const uploads = getUploadsForAlbum(albumPath);
        const maxTimeoutMs = Math.max(...uploads.map((upload) => getProcessingTimeout(upload.uploadPath)));
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
            this.#uploadComplete(upload.uploadPath);
        }
        toast.push('Some media are still processing. Refresh to see them when ready.');
    }

    async #areMediaProcessed(albumPath: string): Promise<boolean> {
        const uploads = getUploadsForAlbum(albumPath);
        if (uploads.length === 0) return true;
        try {
            // Check for processing errors (e.g., video transcoding failures)
            const uploadPaths = uploads.map((upload) => upload.uploadPath);
            const errorResult = await checkMediaErrors(uploadPaths);
            if (errorResult.success && errorResult.errors) {
                for (const [path, errorMessage] of Object.entries(errorResult.errors)) {
                    this.#uploadProcessingFailed(path, errorMessage);
                }
            }

            // Check which uploads have completed successfully
            await albumLoadMachine.reloadAfterChange(albumPath);
            const album = albumState.albums.get(albumPath)?.album;
            if (!album) throw new Error('album not loaded');

            const { processed, allProcessed } = findProcessedUploads(uploads, (mediaPath) => {
                const media = album.getMedia(mediaPath);
                return media?.versionId;
            });

            for (const uploadPath of processed) {
                this.#uploadComplete(uploadPath);
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
    return { path: item.uploadPath, ...(item.replaces === undefined ? {} : { replaces: item.replaces }) };
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
        const uploadPath = albumPath + sanitizeMediaFilename(file.name);
        filesWithPaths.push({ file, uploadPath });
    }

    // Deduplicate paths
    // e.g., my-photo.jpg and my_photo.jpg both become my_photo.jpg, and therefore one needs to become my_photo_1.jpg
    const originalPaths = filesWithPaths.map((item) => item.uploadPath);
    const deduplicatedPaths = deduplicateMediaPaths(originalPaths);

    // Build result with deduplicated paths, which come back one per original path in the same order
    return filesWithPaths.map((item, index) => ({
        file: item.file,
        uploadPath: deduplicatedPaths[index] ?? item.uploadPath,
    }));
}
