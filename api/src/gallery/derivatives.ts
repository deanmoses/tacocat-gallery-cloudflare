import { type ImageRequest, type Size, THUMBNAIL_SIZE, THUMBNAIL_SIZE_2X, detailSize } from '@tacocat-gallery/shared';
import { type Derivation, derivativeName, generateDerivative, outputFormat } from '../media/images';
import { derivedImageKey, originalKey, posterKey } from '../storage/keys';
import { type Steps, bounded } from '../util/stages';

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
 * How long one call an upload makes to R2 or the Images binding may take, a derivative's making and storing counting as
 * one, where a 17 MB photo's whole upload takes seconds.
 */
export const CALL_LIMIT_MS = 60_000;

/**
 * Makes the derivatives the album page and the media page are about to ask for, the thumbnail at both densities and
 * the detail image, so the first reader of an upload never waits for a transformation. Made from what the URLs will
 * ask for, so they are found again by them, and all at once from `source`, the photo or a video's poster, which the
 * caller already holds. A file the Images binding refuses, as it does some HEICs, surfaces here rather than as a
 * broken image in the album. Each one's time goes into `steps` under the same name for every upload.
 */
export async function warmDerivatives(
    env: Pick<Env, 'DERIVED' | 'IMAGES'>,
    path: string,
    versionId: string,
    size: Size,
    source: Blob,
    sourceType: string | undefined,
    steps: Steps,
): Promise<Warmed> {
    const wanted = { thumbnail: THUMBNAIL_SIZE, thumbnail2x: THUMBNAIL_SIZE_2X, detail: detailSize(size) };
    const made = await Promise.allSettled(
        Object.entries(wanted).map(async ([name, imageSize]) => {
            const request: ImageRequest = { path, versionId, size: imageSize, crop: null };
            return bounded(steps, name, CALL_LIMIT_MS, async () =>
                generateDerivative(env, derivationFor(request, null), source.stream(), sourceType),
            );
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
 * The Images binding's codes for a file it will never decode: not an image (9412), over 100 megapixels (9413), a
 * format it does not take (9520, 9523), and 9516, which its docs call internal but which a HEIC written by macOS
 * `sips` gets every time. Any other code is the binding failing to run: 9502, 9522, 9527 and 9529 all came from it
 * while it was busy, and images that had failed with 9527 were made on a later request.
 */
const FILE_FAULTS: ReadonlySet<number> = new Set([9412, 9413, 9516, 9520, 9523]);

/** Whether the Images binding refused the image itself, as against failing to run, which the step's retry is for. */
function isRefusal(error: unknown): error is Error {
    if (!(error instanceof Error)) {
        return false;
    }
    const code =
        'code' in error && typeof error.code === 'number'
            ? error.code
            : Number(/^IMAGES_TRANSFORM_ERROR (?<code>\d+)/v.exec(error.message)?.groups?.['code']);
    return FILE_FAULTS.has(code);
}
