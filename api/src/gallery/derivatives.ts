import { type ImageRequest, type Size, THUMBNAIL_SIZE, THUMBNAIL_SIZE_2X, detailSize } from '@tacocat-gallery/shared';
import { withoutMetadata } from '../media/jpeg';
import {
    type Derivation,
    type Derivative,
    IMMUTABLE,
    type OutputFormat,
    type Transformation,
    derivativeName,
    formatForSource,
    isRefusal,
    outputFormat,
    outputOptions,
    resize,
    throughBinding,
    throughTransformations,
} from '../media/images';
import { derivedImageKey, originalKey, posterKey } from '../storage/keys';
import { type S3Credentials, presign } from '../storage/s3';
import { type Steps, bounded, timed } from '../util/stages';

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

/** An image a derivative is made from, in one of the Worker's buckets. */
export interface Source {
    bucket: 'UPLOADS' | 'ORIGINALS' | 'DERIVED';
    key: string;
    /** The type it was stored with, which decides the format of a derivative whose URL settles none. */
    contentType: string | undefined;
}

/** What making an image takes: each bucket a source can be in, by its binding and its S3 name, and either engine. */
export type ImageEnv = S3Credentials &
    Pick<
        Env,
        | 'IMAGE_MODE'
        | 'IMAGES'
        | 'UPLOADS'
        | 'ORIGINALS'
        | 'DERIVED'
        | 'UPLOADS_BUCKET'
        | 'ORIGINALS_BUCKET'
        | 'DERIVED_BUCKET'
    >;

const BUCKET_NAMES = {
    UPLOADS: 'UPLOADS_BUCKET',
    ORIGINALS: 'ORIGINALS_BUCKET',
    DERIVED: 'DERIVED_BUCKET',
} as const satisfies Record<Source['bucket'], keyof ImageEnv>;

/**
 * The derivative `wanted` names: generated once, stored in the derived bucket, served from it afterwards. The
 * original's key when there is neither it nor a poster to generate from.
 */
export async function derivedImage(
    env: ImageEnv,
    wanted: Derivation,
    steps: Steps,
): Promise<Derivative | { missing: string }> {
    const stored = await timed(steps, 'r2', async () => env.DERIVED.get(wanted.key));
    if (stored) {
        const contentType = stored.httpMetadata?.contentType ?? 'application/octet-stream';
        return { body: stored.body, contentType, how: 'stored' };
    }
    const source = await sourceOf(env, wanted);
    if (source === null) {
        return { missing: wanted.original };
    }

    try {
        return await generated(env, wanted, source);
    } catch (error) {
        if (isRefusal(error)) {
            throw error;
        }
        // The Images binding failed bursts of first-time thumbnails, as an album's first reader asks for, that passed
        // on a later try. The pause is spread, so a page's failures do not all come back at once.
        console.warn({ event: 'derivative_retried', key: wanted.key, error: String(error) });
        await scheduler.wait(RETRY_PAUSE_MS * (1 + Math.random()));
        return generated(env, wanted, source);
    }
}

/** How long a failed transformation waits before its one more try, at least. */
const RETRY_PAUSE_MS = 250;

/**
 * A video's stills come from the poster the transcoder wrote beside its MP4, and only a video has one, so looking for
 * it first is what tells a video from a photo: the file name in the URL decides nothing.
 */
async function sourceOf(env: ImageEnv, wanted: Derivation): Promise<Source | null> {
    const poster = await env.DERIVED.head(wanted.poster);
    if (poster) {
        return { bucket: 'DERIVED', key: wanted.poster, contentType: poster.httpMetadata?.contentType };
    }
    const original = await env.ORIGINALS.head(wanted.original);
    return original && { bucket: 'ORIGINALS', key: wanted.original, contentType: original.httpMetadata?.contentType };
}

async function generated(env: ImageEnv, wanted: Derivation, source: Source): Promise<Derivative> {
    const made = await generateDerivative(env, wanted, source);
    return { body: made.bytes, contentType: made.format, how: 'generated' };
}

/**
 * The derivative `wanted` names, made from `source` and stored in the derived bucket. Mirrors generateDerivedImage's
 * crop-then-cover semantics, and as its Sharp does, writes a JPEG with no metadata.
 */
async function generateDerivative(
    env: ImageEnv,
    { request, format: asked, key }: Derivation,
    source: Source,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; format: OutputFormat }> {
    const format = asked ?? formatForSource(source.contentType);
    const trim =
        request.crop === null
            ? null
            : { left: request.crop.x, top: request.crop.y, width: request.crop.width, height: request.crop.height };
    const encoded = await transformed(env, source, {
        trim,
        resize: resize(request),
        output: outputOptions(format, request.size),
    });
    const bytes = format === 'image/jpeg' ? withoutMetadata(encoded) : encoded;
    await env.DERIVED.put(key, bytes, { httpMetadata: { contentType: format, cacheControl: IMMUTABLE } });
    return { bytes, format };
}

/**
 * The image `transformation` makes of `source`: by Image Transformations, through a URL signed for the one object, or
 * by the Images binding, the source streamed into it, where Image Transformations cannot run.
 */
async function transformed(
    env: ImageEnv,
    source: Source,
    transformation: Transformation,
): Promise<Uint8Array<ArrayBuffer>> {
    if (env.IMAGE_MODE === 'binding') {
        const object = await env[source.bucket].get(source.key);
        if (!object) {
            throw new Error(`${source.key} is not in ${source.bucket}`);
        }
        return throughBinding(env.IMAGES, object.body, transformation);
    }
    const url = await presign(env, { method: 'GET', bucket: env[BUCKET_NAMES[source.bucket]], key: source.key });
    return throughTransformations(url, source.key, transformation);
}

/** The image as a full-size JPEG at a quality that keeps what a viewer would notice, or null when it cannot be decoded. */
export async function asJpeg(env: ImageEnv, source: Source): Promise<Uint8Array<ArrayBuffer> | null> {
    try {
        return await transformed(env, source, {
            trim: null,
            resize: null,
            output: { format: 'image/jpeg', quality: 92 },
        });
    } catch (error) {
        console.warn({ event: 'jpeg_conversion_failed', key: source.key, error: String(error) });
        return null;
    }
}

export type Warmed = { ok: true } | { ok: false; error: string };

/**
 * How long one call an upload makes to R2 or to what makes images may take, a derivative's making and storing counting
 * as one, where a 17 MB photo's whole upload takes seconds.
 */
export const CALL_LIMIT_MS = 60_000;

/**
 * Makes the derivatives the album page and the media page are about to ask for, the thumbnail at both densities and
 * the detail image, so the first reader of an upload never waits for a transformation. Made from what the URLs will
 * ask for, so they are found again by them, and all at once from `source`, the photo or a video's poster. A file that
 * cannot be decoded, as some HEICs cannot, surfaces here rather than as a broken image in the album. Each one's time
 * goes into `steps` under the same name for every upload.
 */
export async function warmDerivatives(
    env: ImageEnv,
    path: string,
    versionId: string,
    size: Size,
    source: Source,
    steps: Steps,
): Promise<Warmed> {
    const wanted = { thumbnail: THUMBNAIL_SIZE, thumbnail2x: THUMBNAIL_SIZE_2X, detail: detailSize(size) };
    const made = await Promise.allSettled(
        Object.entries(wanted).map(async ([name, imageSize]) => {
            const request: ImageRequest = { path, versionId, size: imageSize, crop: null };
            return bounded(steps, name, CALL_LIMIT_MS, async () =>
                generateDerivative(env, derivationFor(request, null), source),
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
