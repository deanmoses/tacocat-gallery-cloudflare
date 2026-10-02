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
