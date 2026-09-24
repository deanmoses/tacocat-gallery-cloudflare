import {
    type ImageRequest,
    cropText,
    derivedPrefix,
    isVideoName,
    parseImageRequest,
    sizeText,
} from 'tacocat-gallery-shared';

export const IMMUTABLE = 'public, max-age=31536000, immutable';
// Every format the Images binding can write; anything else asked for gets a JPEG.
const OUTPUT_FORMATS: readonly ImageOutputOptions['format'][] = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/avif',
    'rgb',
    'rgba',
];

/** How long each step of serving a derivative took, in milliseconds, keyed by its Server-Timing name. */
export type Steps = Record<string, number>;

/** What an image URL asks for, the format it gets, and the key its derivative is stored under. */
export interface DerivedKey {
    request: ImageRequest;
    format: ImageOutputOptions['format'];
    key: string;
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
 * afterwards. Mirrors generateDerivedImage's crop-then-cover semantics. The source's key when there is no such
 * original or poster to generate from.
 */
export async function derivedImage(
    env: Pick<Env, 'MEDIA' | 'DERIVED' | 'IMAGES'>,
    wanted: DerivedKey,
    steps: Steps,
): Promise<Derivative | { missing: string }> {
    const { request, format, key } = wanted;

    const stored = await timed(steps, 'r2', async () => env.DERIVED.get(key));
    if (stored) {
        return { body: stored.body, format, how: 'stored' };
    }

    // A video's stills come from the poster the transcoder wrote beside its MP4.
    const itemName = request.path.slice(request.path.lastIndexOf('/') + 1);
    const sourceKey = isVideoName(itemName)
        ? `${derivedPrefix(request.path, request.versionId)}/poster.jpg`
        : `originals${request.path}/${request.versionId}`;
    const original = await env.MEDIA.get(sourceKey);
    if (!original) {
        return { missing: sourceKey };
    }

    const { width, height } = request.size;
    let transformer = env.IMAGES.input(byteStream(original.body));
    if (request.crop !== null) {
        const { x: left, y: top, width: cropWidth, height: cropHeight } = request.crop;
        transformer = transformer.transform({ trim: { left, top, width: cropWidth, height: cropHeight } });
    }
    transformer = transformer.transform({
        ...(width !== null && { width }),
        ...(height !== null && { height }),
        fit: width !== null && height !== null ? 'cover' : 'scale-down',
    });
    const output = await transformer.output({ format, quality: 85 });
    const bytes = await output.response().arrayBuffer();
    await env.DERIVED.put(key, bytes, { httpMetadata: { contentType: format, cacheControl: IMMUTABLE } });
    return { body: bytes, format, how: 'generated' };
}

/** What the URL asks for and the key its derivative is stored under, or null for a URL imageUrl would not write. */
export function derivedKey(url: URL, prefix: string): DerivedKey | null {
    const request = parseImageRequest(url.pathname.slice(prefix.length), url.searchParams);
    if (request === null) {
        return null;
    }
    const requested = url.searchParams.get('format') ?? 'image/jpeg';
    const format = OUTPUT_FORMATS.find((known) => known === requested) ?? 'image/jpeg';
    const cropped = request.crop === null ? '' : `-${cropText(request.crop)}`;
    const suffix = `${sizeText(request.size)}${cropped}-${format.split('/', 2)[1] ?? ''}`;
    return { request, format, key: `${derivedPrefix(request.path, request.versionId)}/${suffix}` };
}

/**
 * R2 bodies and Blob streams are typed ReadableStream<any>, which the Images binding refuses. workerd's identity
 * stream passes the bytes through unchanged and is typed as yielding Uint8Array.
 */
export function byteStream(stream: ReadableStream): ReadableStream<Uint8Array> {
    return stream.pipeThrough(new IdentityTransformStream());
}
