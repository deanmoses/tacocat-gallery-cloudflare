import {
    type ImageRequest,
    cropText,
    derivedPrefix,
    isVideoName,
    parseImageRequest,
    sizeText,
} from 'tacocat-gallery-shared';
import { json, notFound, pathAfter } from './http';

const IMMUTABLE = 'public, max-age=31536000, immutable';
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
type Steps = Record<string, number>;

interface Derivative {
    body: ArrayBuffer | ReadableStream;
    format: ImageOutputOptions['format'];
    how: 'stored' | 'generated';
}

export async function raw(request: Request, env: Env): Promise<Response> {
    const object = await env.MEDIA.get(pathAfter(new URL(request.url), '/raw/'));
    if (!object) {
        return notFound();
    }
    return new Response(object.body, {
        headers: { 'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream' },
    });
}

/**
 * Worker in front, per-colo Cache API: a hit never reaches R2, but every colo fills from R2 on its own. Each response
 * says how long its steps took, in Server-Timing and a log line, since a colo's first request is the slow one.
 */
export async function derivedViaCacheApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const cache = caches.default;
    const steps: Steps = {};
    const hit = await timed(steps, 'cache', async () => cache.match(request));
    if (hit) {
        const response = new Response(hit.body, hit);
        return reported(request, response, 'cache-api-hit', steps);
    }
    const derivative = await derivedImage(env, new URL(request.url), '/i', steps);
    if (derivative instanceof Response) {
        return derivative;
    }
    const response = new Response(derivative.body, {
        headers: { 'cache-control': IMMUTABLE, 'content-type': derivative.format },
    });
    ctx.waitUntil(cache.put(request, response.clone()));
    return reported(request, response, derivative.how, steps);
}

async function timed<T>(steps: Steps, name: string, work: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
        return await work();
    } finally {
        steps[name] = performance.now() - started;
    }
}

function reported(request: Request, response: Response, how: string, steps: Steps): Response {
    response.headers.set('x-derived', how);
    for (const [name, ms] of Object.entries(steps)) {
        response.headers.append('server-timing', `${name};dur=${ms.toFixed(1)}`);
    }
    console.info({
        event: 'derived_image',
        colo: request.cf?.colo,
        how,
        path: new URL(request.url).pathname,
        ...steps,
    });
    return response;
}

/**
 * Worker fetches the derivative through the derived bucket's custom domain, so it goes through the CDN cache and
 * Tiered Cache like any origin fetch. Generates on a 404.
 */
export async function derivedViaCdn(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const wanted = derivedKey(url, '/i2');
    if (wanted === null) {
        return badImageUrl();
    }
    // Only successes are cached: a 404 from before the derivative was generated would otherwise stick for a year.
    const upstream = await fetch(`${env.DERIVED_ORIGIN}/${wanted.key}`, {
        cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': 31_536_000, '400-599': -1 } },
    });
    if (upstream.ok) {
        const response = new Response(upstream.body, upstream);
        const cacheStatus = upstream.headers.get('cf-cache-status')?.toLowerCase() ?? 'unknown';
        response.headers.set('x-derived', `cdn-${cacheStatus}`);
        return response;
    }
    const derivative = await derivedImage(env, url, '/i2', {});
    if (derivative instanceof Response) {
        return derivative;
    }
    return new Response(derivative.body, {
        headers: { 'cache-control': IMMUTABLE, 'content-type': derivative.format, 'x-derived': derivative.how },
    });
}

/**
 * /i/<path>/<versionId>?size=200x200&crop=x,y,w,h — generated once with the Images binding, stored in the derived
 * bucket, served from it afterwards. Mirrors generateDerivedImage's crop-then-cover semantics.
 */
async function derivedImage(env: Env, url: URL, prefix: string, steps: Steps): Promise<Derivative | Response> {
    const wanted = derivedKey(url, prefix);
    if (wanted === null) {
        return badImageUrl();
    }
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
        return json({ error: 'source not found', key: sourceKey }, 404);
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
function derivedKey(
    url: URL,
    prefix: string,
): { request: ImageRequest; format: ImageOutputOptions['format']; key: string } | null {
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

function badImageUrl(): Response {
    return json({ error: 'expected /i/<media path>/<versionId>?size=200x200&crop=x,y,width,height' }, 400);
}

/** Isolates Images binding failures from how the bytes reach it: R2 stream, buffered stream, and each step. */
export async function debugImage(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const key = pathAfter(url, '/debug/image/');
    const head = await env.MEDIA.get(key);
    if (!head) {
        return notFound({ key });
    }
    const bytes = new Uint8Array(await head.arrayBuffer());
    const blob = new Blob([bytes]);
    const buffered = (): ReadableStream<Uint8Array> => byteStream(blob.stream());
    const decoder = new TextDecoder();
    return json({
        key,
        size: bytes.length,
        magic: decoder.decode(bytes.slice(4, 12)),
        infoFromR2Stream: await attempt(async () => {
            const again = await env.MEDIA.get(key);
            if (!again) {
                throw new Error('object vanished');
            }
            return env.IMAGES.info(byteStream(again.body));
        }),
        infoBuffered: await attempt(async () => env.IMAGES.info(buffered())),
        jpegNoTransform: await attempt(async () => {
            const output = await env.IMAGES.input(buffered()).output({ format: 'image/jpeg' });
            const response = output.response();
            const body = await response.arrayBuffer();
            return { status: response.status, type: response.headers.get('content-type'), bytes: body.byteLength };
        }),
        jpegWidth512: await attempt(async () => {
            const output = await env.IMAGES.input(buffered())
                .transform({ width: 512 })
                .output({ format: 'image/jpeg' });
            const response = output.response();
            const body = await response.arrayBuffer();
            return { status: response.status, bytes: body.byteLength };
        }),
    });
}

/**
 * R2 bodies and Blob streams are typed ReadableStream<any>, which the Images binding refuses. workerd's identity
 * stream passes the bytes through unchanged and is typed as yielding Uint8Array.
 */
function byteStream(stream: ReadableStream): ReadableStream<Uint8Array> {
    return stream.pipeThrough(new IdentityTransformStream());
}

async function attempt(
    run: () => Promise<unknown>,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
    try {
        return { ok: true, value: await run() };
    } catch (error) {
        return { ok: false, error: String(error) };
    }
}
