import {
    API,
    type PresignRequest,
    type PresignResponse,
    type PresignedUpload,
    parsePresigned,
} from '@tacocat-gallery/shared';
import { callApi, failureMessage } from './adminApi';

export type UploadResult = { success: true } | { success: false; error: string };

export type PresignedUrlResult = { success: true; uploads: PresignResponse } | { success: false; error: string };

/**
 * PUTs the file straight into the bucket, at the URL the Worker signed for it, as the content type the URL was signed
 * with: the bucket refuses any other, whatever the browser takes the file for.
 *
 * @param file File to upload
 * @param presigned Where to PUT it, and as what type
 * @returns Success, or failure with error message
 */
export async function uploadToBucket(file: File, presigned: PresignedUpload): Promise<UploadResult> {
    try {
        const response = await fetch(presigned.url, {
            method: 'PUT',
            headers: {
                'Content-Type': presigned.contentType,
            },
            body: file,
        });

        return response.ok ? { success: true } : { success: false, error: response.statusText };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, error: msg };
    }
}

// How long to wait before each try after the first, when the server could not start the upload's processing.
const ANNOUNCE_RETRY_MS = [1000, 3000];

/**
 * Tells the server the upload's PUT succeeded, so it starts processing the file at once. Once this succeeds, the
 * upload will be processed whatever the page does next. The server answers 503 when it could not start the processing,
 * which is worth another try, as is a request that never reached it.
 *
 * @param versionId The version presign minted for the upload
 * @returns Success, or failure with error message
 */
export async function announceUpload(versionId: string): Promise<UploadResult> {
    for (let attempt = 0; ; attempt++) {
        let error: string;
        let retryable: boolean;
        try {
            const response = await callApi(API.uploaded, `/${versionId}`);
            if (response.ok) return { success: true };
            error = await failureMessage(response);
            retryable = response.status >= 500;
        } catch (thrown) {
            error = thrown instanceof Error ? thrown.message : String(thrown);
            retryable = true;
        }
        const delay = ANNOUNCE_RETRY_MS[attempt];
        if (!retryable || delay === undefined) return { success: false, error };
        await new Promise((resolve) => {
            setTimeout(resolve, delay);
        });
    }
}

/**
 * Fetch presigned upload URLs from the server. Each upload comes back with the versionId the media item will carry once
 * the server has processed it.
 *
 * @param albumPath Album path like /2024/01-01/
 * @param uploads What each upload will be: its full media path, its file's extension, and whether it replaces an item
 * @returns Map of media path to its presigned URL and versionId, or failure with error message
 */
export async function fetchPresignedUrls(albumPath: string, uploads: PresignRequest): Promise<PresignedUrlResult> {
    try {
        const response = await callApi(API.presign, albumPath, uploads);

        return response.ok
            ? { success: true, uploads: parsePresigned(await response.json()) }
            : { success: false, error: await failureMessage(response) };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, error: msg };
    }
}
