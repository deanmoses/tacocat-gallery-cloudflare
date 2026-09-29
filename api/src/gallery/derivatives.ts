import { type ImageRequest, type Size, THUMBNAIL_SIZE, THUMBNAIL_SIZE_2X, detailSize } from '@tacocat-gallery/shared';
import { type Derivation, derivativeName, generateDerivative, outputFormat } from '../media/images';
import { derivedImageKey, originalKey, posterKey } from '../storage/keys';

/**
 * Where the derivative an image URL asks for lives and what it is made from. Its format is the one the URL settles, or
 * null where the source decides.
 */
export function derivationFor(request: ImageRequest, requestedFormat: string | null): Derivation {
    const format = outputFormat(requestedFormat, request.size);
    return {
        request,
        format,
        key: derivedImageKey(request.versionId, derivativeName(request, format)),
        poster: posterKey(request.versionId),
        original: originalKey(request.versionId),
    };
}

export type Warmed = { ok: true } | { ok: false; error: string };

/**
 * Makes the derivatives the album page and the media page are about to ask for, the thumbnail at both densities and
 * the detail image, so the first reader of an upload never waits for a transformation. Made from what the URLs will
 * ask for, so they are found again by them, and all at once from `source`, the photo or a video's poster, which the
 * caller already holds. A file the Images binding refuses, as it does some HEICs, surfaces here rather than as a
 * broken image in the album.
 */
export async function warmDerivatives(
    env: Pick<Env, 'DERIVED' | 'IMAGES'>,
    path: string,
    versionId: string,
    size: Size,
    source: Blob,
    sourceType: string | undefined,
): Promise<Warmed> {
    const made = await Promise.allSettled(
        [THUMBNAIL_SIZE, THUMBNAIL_SIZE_2X, detailSize(size)].map(async (wanted) => {
            const request: ImageRequest = { path, versionId, size: wanted, crop: null };
            return generateDerivative(env, derivationFor(request, null), source.stream(), sourceType);
        }),
    );
    const failures = made.flatMap((result): unknown[] => (result.status === 'rejected' ? [result.reason] : []));
    const refusal = failures.find(isRefusal);
    if (refusal !== undefined) {
        return { ok: false, error: `the image cannot be decoded: ${refusal.message}` };
    }
    if (failures.length > 0) {
        throw failures[0];
    }
    return { ok: true };
}

/**
 * Whether the Images binding refused the image itself, which it reports as an error carrying a numeric code, as
 * against failing to run, which the queue retries. Its codes are not documented well enough to tell a bad file from a
 * bad day apart by number, so every refusal is taken as the file's.
 */
function isRefusal(error: unknown): error is Error {
    return (
        error instanceof Error &&
        (('code' in error && typeof error.code === 'number') || error.message.startsWith('IMAGES_TRANSFORM_ERROR'))
    );
}
