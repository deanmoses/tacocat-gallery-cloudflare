import { type ImageRequest, type MediaType, type Size, THUMBNAIL_SIZE, detailSize } from 'tacocat-gallery-shared';
import { type Derivation, derivativeName, derivedImage, outputFormat } from '../media/images';
import { derivedImageKey, originalKey, posterKey } from '../storage/keys';

/** Where the derivative an image URL asks for lives, in the format its `format` parameter asks for, and its sources. */
export function derivationFor(request: ImageRequest, requestedFormat: string | null): Derivation {
    const format = outputFormat(requestedFormat);
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
 * Makes the two derivatives the album page and the media page are about to ask for, the thumbnail and the detail
 * image, so the first reader of an upload never waits for a transformation. Made from what the URLs will ask for, so
 * they are found again by them. A file the Images binding refuses, as it does some HEICs, surfaces here rather than
 * as a broken image in the album. A video's stills come from its poster and from nothing else, since the binding
 * cannot read the video itself, so a video whose transcoder wrote no poster, which only a test's stand-in does, is
 * left for its first reader.
 */
export async function warmDerivatives(
    env: Pick<Env, 'MEDIA' | 'DERIVED' | 'IMAGES'>,
    path: string,
    versionId: string,
    facts: Size & { mediaType: MediaType },
): Promise<Warmed> {
    if (facts.mediaType === 'video' && (await env.DERIVED.head(posterKey(versionId))) === null) {
        console.warn({ event: 'derivative_not_warmed', versionId, missing: posterKey(versionId) });
        return { ok: true };
    }
    for (const size of [THUMBNAIL_SIZE, detailSize(facts)]) {
        const request: ImageRequest = { path, versionId, size, crop: null };
        try {
            const made = await derivedImage(env, derivationFor(request, null), {});
            if ('missing' in made) {
                throw new Error(`no source for ${made.missing}`);
            }
        } catch (error) {
            if (isRefusal(error)) {
                return { ok: false, error: `the image cannot be decoded: ${error.message}` };
            }
            throw error;
        }
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
