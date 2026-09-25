import { isHeicName, parseImageRequest, parseMediaVersion } from 'tacocat-gallery-shared';
import { pathAfter } from '../http/paths';
import { failure, notFound } from '../http/responses';
import {
    type Derivation,
    type Derivative,
    IMMUTABLE,
    type Steps,
    asJpeg,
    derivativeName,
    derivedImage,
    outputFormat,
    timed,
} from '../media/images';
import { derivedImageKey, originalKey, posterKey } from '../storage/keys';

/**
 * `GET /raw/<media path>/<versionId>`: that version's original, as uploaded. Only Safari can show a HEIC, so one comes
 * back as a full-size JPEG made on the way out, unless `?format=original` asks for the file itself or the Images
 * binding cannot decode it, when the file itself is the best answer there is. The version is the key, so a file that
 * was renamed is still found by an old URL; the path in the URL is for whoever reads it, and names the download.
 */
export async function raw(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const wanted = parseMediaVersion(pathAfter(url, '/raw'));
    if (wanted === null) {
        return failure(400, 'expected /raw/<media path>/<versionId>');
    }
    const object = await env.MEDIA.get(originalKey(wanted.versionId));
    if (!object) {
        return notFound();
    }
    const name = wanted.path.slice(wanted.path.lastIndexOf('/') + 1);
    const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream';
    if (!isHeicName(name) || url.searchParams.get('format') === 'original') {
        return file(object.body, contentType, name);
    }
    const bytes = await object.arrayBuffer();
    const jpeg = await asJpeg(env, bytes);
    return jpeg === null ? file(bytes, contentType, name) : file(jpeg, 'image/jpeg', name.replace(/\.[^.]+$/v, '.jpg'));
}

/** A file to show inline, named for a download, kept for a year since its URL names one version. */
function file(body: BodyInit, contentType: string, name: string): Response {
    // The plain form holds printable ASCII with no quote or backslash; the starred form carries the name as it is.
    const ascii = Array.from(name, (char) =>
        char >= ' ' && char <= '~' && char !== '"' && char !== '\\' ? char : '_',
    ).join('');
    return new Response(body, {
        headers: {
            'content-type': contentType,
            'content-disposition': `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
            'cache-control': IMMUTABLE,
        },
    });
}

/**
 * Worker in front, per-colo Cache API: a hit never reaches R2, but every colo fills from R2 on its own. Each response
 * says how long its steps took, in Server-Timing and a log line, since a colo's first request is the slow one.
 */
export async function derivedViaCacheApi(
    request: Request,
    env: Env,
    ctx: Pick<ExecutionContext, 'waitUntil'>,
): Promise<Response> {
    const cache = caches.default;
    const steps: Steps = {};
    const hit = await timed(steps, 'cache', async () => cache.match(request));
    if (hit) {
        const response = new Response(hit.body, hit);
        return reported(request, response, 'cache-api-hit', steps);
    }
    const wanted = derivation(new URL(request.url), '/i');
    if (wanted === null) {
        return badImageUrl();
    }
    const derivative = await derivedImage(env, wanted, steps);
    if ('missing' in derivative) {
        return sourceNotFound(derivative.missing);
    }
    const response = new Response(derivative.body, {
        headers: { 'cache-control': IMMUTABLE, 'content-type': derivative.format },
    });
    ctx.waitUntil(cache.put(request, response.clone()));
    return reported(request, response, derivative.how, steps);
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
    const wanted = derivation(url, '/i2');
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
    const derivative = await derivedImage(env, wanted, {});
    return 'missing' in derivative ? sourceNotFound(derivative.missing) : generated(derivative);
}

/** What the URL asks for and where its derivative and sources are, or null for a URL imageUrl would not write. */
function derivation(url: URL, prefix: string): Derivation | null {
    const request = parseImageRequest(url.pathname.slice(prefix.length), url.searchParams);
    if (request === null) {
        return null;
    }
    const format = outputFormat(url.searchParams.get('format'));
    return {
        request,
        format,
        key: derivedImageKey(request.versionId, derivativeName(request, format)),
        poster: posterKey(request.versionId),
        original: originalKey(request.versionId),
    };
}

function generated(derivative: Derivative): Response {
    return new Response(derivative.body, {
        headers: { 'cache-control': IMMUTABLE, 'content-type': derivative.format, 'x-derived': derivative.how },
    });
}

function sourceNotFound(key: string): Response {
    return notFound(`No source for ${key}`);
}

function badImageUrl(): Response {
    return failure(400, 'expected /i/<media path>/<versionId>?size=200x200&crop=x,y,width,height');
}
