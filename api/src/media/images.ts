import { type ImageRequest, type ImageSize, THUMBNAIL_SIZE_2X, cropText, sizeText } from '@tacocat-gallery/shared';
import { type Steps, timed } from '../util/stages';
import { withoutMetadata } from './jpeg';

export const IMMUTABLE = 'public, max-age=31536000, immutable';
// Every image format the Images binding can write; anything else asked for, its raw pixel formats included, gets the
// default.
const OUTPUT_FORMATS: readonly ImageOutputOptions['format'][] = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/avif',
];

/**
 * Where a cover crop is centred when the URL brings no crop of its own: halfway across and a third of the way down,
 * where a standing person's face is likelier to be than in the middle. The AWS image CDN centred every thumbnail
 * nobody had recut on that point, so the gallery's thumbnails keep the framing they have had for years; `box-center`
 * is the mode that centres the cut on the point rather than aligning proportions.
 */
const DEFAULT_FOCUS = { x: 0.5, y: 1 / 3, mode: 'box-center' } as const;

const WEBP_SOURCES: ReadonlySet<string> = new Set(['image/gif', 'image/png']);

/** What an image URL asks for, the format it gets, and where its derivative and the sources it is made from are. */
export interface Derivation {
    request: ImageRequest;
    /** Null when the source's content type decides the format. */
    format: ImageOutputOptions['format'] | null;
    /** The derivative, in the derived bucket. */
    key: string;
    /** The version's poster in the derived bucket, which a video has and a photo does not. */
    poster: string;
    /** The version's file as uploaded, in the originals bucket. */
    original: string;
}

export interface Derivative {
    body: Uint8Array<ArrayBuffer> | ReadableStream;
    contentType: string;
    how: 'stored' | 'generated';
}

/**
 * The derivative `wanted` names: generated once with the Images binding, stored in the derived bucket, served from it
 * afterwards. The original's key when there is neither it nor a poster to generate from.
 */
export async function derivedImage(
    env: Pick<Env, 'ORIGINALS' | 'DERIVED' | 'IMAGES'>,
    wanted: Derivation,
    steps: Steps,
): Promise<Derivative | { missing: string }> {
    const stored = await timed(steps, 'r2', async () => env.DERIVED.get(wanted.key));
    if (stored) {
        const contentType = stored.httpMetadata?.contentType ?? 'application/octet-stream';
        return { body: stored.body, contentType, how: 'stored' };
    }

    try {
        return await generated(env, wanted);
    } catch (error) {
        if (isRefusal(error)) {
            throw error;
        }
        // A busy binding fails a burst of first-time thumbnails, as an album's first reader asks for, and passes on
        // a later try. The pause is spread, so a page's failures do not all come back at once.
        console.warn({ event: 'derivative_retried', key: wanted.key, error: String(error) });
        await scheduler.wait(RETRY_PAUSE_MS * (1 + Math.random()));
        return generated(env, wanted);
    }
}

/** How long a failed transformation waits before its one more try, at least. */
const RETRY_PAUSE_MS = 250;

async function generated(
    env: Pick<Env, 'ORIGINALS' | 'DERIVED' | 'IMAGES'>,
    wanted: Derivation,
): Promise<Derivative | { missing: string }> {
    // A video's stills come from the poster the transcoder wrote beside its MP4, and only a video has one, so looking
    // for it first is what tells a video from a photo: the file name in the URL decides nothing.
    const source = (await env.DERIVED.get(wanted.poster)) ?? (await env.ORIGINALS.get(wanted.original));
    if (!source) {
        return { missing: wanted.original };
    }
    const made = await generateDerivative(env, wanted, source.body, source.httpMetadata?.contentType);
    return { body: made.bytes, contentType: made.format, how: 'generated' };
}

/**
 * The Images binding's codes its docs give for a fault in the file: not an image (9412), over 100 megapixels (9413),
 * and a format it does not take (9520). A refusal drops an upload, so any other code is taken as the binding failing
 * to run and is tried again, the costlier mistake being the other way round: 9502, 9522, 9527 and 9529 all came from
 * it while it was busy, and images that had failed with 9527 were made on a later request. A HEIC written by macOS
 * `sips` gets 9516, which the docs call internal, every time.
 */
const FILE_FAULTS: ReadonlySet<number> = new Set([9412, 9413, 9520]);

/** Whether the Images binding refused the image itself, as against failing to run, which a later try may get past. */
export function isRefusal(error: unknown): error is Error {
    if (!(error instanceof Error)) {
        return false;
    }
    const code =
        'code' in error && typeof error.code === 'number'
            ? error.code
            : Number(/^IMAGES_TRANSFORM_ERROR (?<code>\d+)/v.exec(error.message)?.groups?.['code']);
    return FILE_FAULTS.has(code);
}

/**
 * The derivative `wanted` names, made from `source` with the Images binding and stored in the derived bucket. Mirrors
 * generateDerivedImage's crop-then-cover semantics, and as its Sharp does, writes a JPEG with no metadata.
 */
export async function generateDerivative(
    env: Pick<Env, 'DERIVED' | 'IMAGES'>,
    { request, format: asked, key }: Derivation,
    source: ReadableStream,
    sourceType: string | undefined,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; format: ImageOutputOptions['format'] }> {
    const format = asked ?? formatForSource(sourceType);
    let transformer = env.IMAGES.input(byteStream(source));
    if (request.crop !== null) {
        const { x: left, y: top, width: cropWidth, height: cropHeight } = request.crop;
        transformer = transformer.transform({ trim: { left, top, width: cropWidth, height: cropHeight } });
    }
    const output = await transformer.transform(resize(request)).output(outputOptions(format, request.size));
    const encoded = new Uint8Array(await output.response().arrayBuffer());
    const bytes = format === 'image/jpeg' ? withoutMetadata(encoded) : encoded;
    await env.DERIVED.put(key, bytes, { httpMetadata: { contentType: format, cacheControl: IMMUTABLE } });
    return { bytes, format };
}

/**
 * The resize a request asks for. Both sides given means the image is cut to cover them, from the default focus unless
 * the request brought its own crop, which has chosen the frame already; one side means it is scaled to that side and
 * never enlarged.
 */
export function resize({ size: { width, height }, crop }: ImageRequest): ImageTransform {
    return width !== null && height !== null
        ? { width, height, fit: 'cover', ...(crop === null && { gravity: DEFAULT_FOCUS }) }
        : { ...(width !== null && { width }), ...(height !== null && { height }), fit: 'scale-down' };
}

/**
 * How the binding encodes a derivative. A thumbnail, which asks for both sides, is one frame whatever the source: an
 * album page of animated GIFs would be a wall of motion, and the binding animates by default. The 2x WebP thumbnail
 * alone is encoded softer, for the reasons measured in https://github.com/deanmoses/tacocat-gallery-cloudflare/issues/81.
 */
export function outputOptions(format: ImageOutputOptions['format'], size: ImageSize): ImageOutputOptions {
    const thumbnail = size.width !== null && size.height !== null;
    const softer =
        format === 'image/webp' && size.width === THUMBNAIL_SIZE_2X.width && size.height === THUMBNAIL_SIZE_2X.height;
    return { format, quality: softer ? 75 : 85, ...(thumbnail && { anim: false }) };
}

/**
 * The image as a full-size JPEG at a quality that keeps what a viewer would notice, or null when the Images binding
 * cannot decode the file, as it cannot some HEICs.
 */
export async function asJpeg(env: Pick<Env, 'IMAGES'>, bytes: ArrayBuffer): Promise<ArrayBuffer | null> {
    try {
        const output = await env.IMAGES.input(byteStream(new Blob([bytes]).stream())).output({
            format: 'image/jpeg',
            quality: 92,
        });
        return await output.response().arrayBuffer();
    } catch (error) {
        console.warn({ event: 'jpeg_conversion_failed', error: String(error) });
        return null;
    }
}

/**
 * The format a URL settles: the one its `format` parameter asks for, when the binding can write it, and otherwise WebP
 * for a thumbnail, which asks for both sides, since every browser the app supports shows it; null for an image asked
 * for by one side, the media page's, since its source decides. A JPEG from the binding carries the original's IPTC and
 * XMP blocks whole and most of its EXIF, GPS position included, whatever its `metadata` option is set to, until
 * `generateDerivative` strips them; its WebP carries nothing.
 */
export function outputFormat(requested: string | null, size: ImageSize): ImageOutputOptions['format'] | null {
    const asked = OUTPUT_FORMATS.find((known) => known === requested);
    if (asked !== undefined) {
        return asked;
    }
    return size.width !== null && size.height !== null ? 'image/webp' : null;
}

/**
 * The format of an image asked for by one side whose URL names none: WebP for a GIF or a PNG, as the AWS site made
 * them, since it keeps a GIF's frames and a PNG's transparency; JPEG for a photo or a video's poster, since readers
 * drag the media page's image into other apps, most of which cannot open a WebP.
 */
export function formatForSource(contentType: string | undefined): ImageOutputOptions['format'] {
    return contentType !== undefined && WEBP_SOURCES.has(contentType) ? 'image/webp' : 'image/jpeg';
}

/**
 * What a derivative is called under its version: the size, crop and the format the URL settles, spelled from the same
 * text as the URL so that it is found again only by a URL spelled the same way. One whose source decides its format
 * has none in its name.
 */
export function derivativeName(request: ImageRequest, format: ImageOutputOptions['format'] | null): string {
    const cropped = request.crop === null ? '' : `-${cropText(request.crop)}`;
    const typed = format === null ? '' : `-${format.split('/', 2)[1] ?? ''}`;
    return `${sizeText(request.size)}${cropped}${typed}`;
}

/**
 * R2 bodies and Blob streams are typed ReadableStream<any>, which the Images binding refuses. workerd's identity
 * stream passes the bytes through unchanged and is typed as yielding Uint8Array.
 */
export function byteStream(stream: ReadableStream): ReadableStream<Uint8Array> {
    return stream.pipeThrough(new IdentityTransformStream());
}
