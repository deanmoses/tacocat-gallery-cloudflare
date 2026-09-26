import { type ImageRequest, cropText, sizeText } from 'tacocat-gallery-shared';

export const IMMUTABLE = 'public, max-age=31536000, immutable';
// Every image format the Images binding can write; anything else asked for, its raw pixel formats included, gets a
// JPEG.
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

/** How long each step of serving a derivative took, in milliseconds, keyed by its Server-Timing name. */
export type Steps = Record<string, number>;

/** What an image URL asks for, the format it gets, and where its derivative and the sources it is made from are. */
export interface Derivation {
    request: ImageRequest;
    format: ImageOutputOptions['format'];
    /** The derivative, in the derived bucket. */
    key: string;
    /** The version's poster in the derived bucket, which a video has and a photo does not. */
    poster: string;
    /** The version's file as uploaded, in the media bucket. */
    original: string;
}

export interface Derivative {
    body: ArrayBuffer | ReadableStream;
    format: ImageOutputOptions['format'];
    how: 'stored' | 'generated';
}

export async function timed<T>(steps: Steps, name: string, work: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
        return await work();
    } finally {
        steps[name] = performance.now() - started;
    }
}

/**
 * The derivative `wanted` names: generated once with the Images binding, stored in the derived bucket, served from it
 * afterwards. Mirrors generateDerivedImage's crop-then-cover semantics. The original's key when there is neither it
 * nor a poster to generate from.
 */
export async function derivedImage(
    env: Pick<Env, 'MEDIA' | 'DERIVED' | 'IMAGES'>,
    wanted: Derivation,
    steps: Steps,
): Promise<Derivative | { missing: string }> {
    const { request, format, key } = wanted;

    const stored = await timed(steps, 'r2', async () => env.DERIVED.get(key));
    if (stored) {
        return { body: stored.body, format, how: 'stored' };
    }

    // A video's stills come from the poster the transcoder wrote beside its MP4, and only a video has one, so looking
    // for it first is what tells a video from a photo: the file name in the URL decides nothing.
    const source = (await env.DERIVED.get(wanted.poster)) ?? (await env.MEDIA.get(wanted.original));
    if (!source) {
        return { missing: wanted.original };
    }

    let transformer = env.IMAGES.input(byteStream(source.body));
    if (request.crop !== null) {
        const { x: left, y: top, width: cropWidth, height: cropHeight } = request.crop;
        transformer = transformer.transform({ trim: { left, top, width: cropWidth, height: cropHeight } });
    }
    const output = await transformer.transform(resize(request)).output({ format, quality: 85 });
    const bytes = await output.response().arrayBuffer();
    await env.DERIVED.put(key, bytes, { httpMetadata: { contentType: format, cacheControl: IMMUTABLE } });
    return { body: bytes, format, how: 'generated' };
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

/** The format a URL's `format` parameter asks for, when the binding can write it. */
export function outputFormat(requested: string | null): ImageOutputOptions['format'] {
    return OUTPUT_FORMATS.find((known) => known === requested) ?? 'image/jpeg';
}

/**
 * What a derivative is called under its version: the size, crop and format, spelled from the same text as the URL so
 * that it is found again only by a URL spelled the same way.
 */
export function derivativeName(request: ImageRequest, format: ImageOutputOptions['format']): string {
    const cropped = request.crop === null ? '' : `-${cropText(request.crop)}`;
    return `${sizeText(request.size)}${cropped}-${format.split('/', 2)[1] ?? ''}`;
}

/**
 * R2 bodies and Blob streams are typed ReadableStream<any>, which the Images binding refuses. workerd's identity
 * stream passes the bytes through unchanged and is typed as yielding Uint8Array.
 */
export function byteStream(stream: ReadableStream): ReadableStream<Uint8Array> {
    return stream.pipeThrough(new IdentityTransformStream());
}
