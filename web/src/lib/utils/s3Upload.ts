import { type PresignRequest, type PresignResponse, parsePresigned } from 'tacocat-gallery-shared';
import { getPresignedUploadUrlGenerationUrl } from './config';
import { adminApi, failureMessage } from './adminApi';

export type S3UploadResult = { success: true } | { success: false; error: string };

export type PresignedUrlResult = { success: true; uploads: PresignResponse } | { success: false; error: string };

/**
 * Upload a file to the media bucket via presigned URL.
 *
 * @param file File to upload
 * @param presignedUrl presigned URL
 * @returns Success, or failure with error message
 */
export async function uploadToS3(file: File, presignedUrl: string): Promise<S3UploadResult> {
    try {
        const response = await fetch(presignedUrl, {
            method: 'PUT',
            headers: {
                'Content-Type': file.type,
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
 * @param uploads What each upload will be: its full media path, and for a replacement, the path it replaces
 * @returns Map of media path to its presigned URL and versionId, or failure with error message
 */
export async function fetchPresignedUrls(albumPath: string, uploads: PresignRequest): Promise<PresignedUrlResult> {
    try {
        const response = await adminApi.post(getPresignedUploadUrlGenerationUrl(albumPath), uploads);

        return response.ok
            ? { success: true, uploads: parsePresigned(await response.json()) }
            : { success: false, error: await failureMessage(response) };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, error: msg };
    }
}
