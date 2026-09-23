import { mediaErrorsUrl } from './config';

export interface MediaErrorsResponse {
    success: boolean;
    errors?: Record<string, string>;
    error?: string;
}

/**
 * Check the backend for media processing errors.
 * This is called during upload processing to detect if videos or images failed to process.
 *
 * @param paths Array of media paths to check for errors
 * @returns Object with success flag and any errors keyed by path
 */
export async function checkMediaErrors(paths: string[]): Promise<MediaErrorsResponse> {
    if (paths.length === 0) {
        return { success: true };
    }

    try {
        const response = await fetch(mediaErrorsUrl(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ paths }),
        });

        if (!response.ok) {
            return {
                success: false,
                error: `HTTP ${response.status}: ${response.statusText}`,
            };
        }

        const data: unknown = await response.json();
        const errors = errorsIn(data);
        return errors === undefined ? { success: true } : { success: true, errors };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/** The failures the server reports, keyed by path, when the body carries any. */
function errorsIn(body: unknown): Record<string, string> | undefined {
    if (typeof body !== 'object' || body === null || !('errors' in body)) return undefined;
    const { errors } = body;
    return isStringRecord(errors) ? errors : undefined;
}

function isStringRecord(value: unknown): value is Record<string, string> {
    return (
        typeof value === 'object' &&
        value !== null &&
        Object.values(value).every((entry: unknown) => typeof entry === 'string')
    );
}
