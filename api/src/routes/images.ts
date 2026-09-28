import { parseImageRequest, parseMediaVersion } from 'tacocat-gallery-shared';
import { pathAfter } from '../http/paths';
import { failure, notFound } from '../http/responses';
import { derivationFor } from '../gallery/derivatives';
import { type Derivation, IMMUTABLE, type Steps, asJpeg, derivedImage, timed } from '../media/images';
import { extensionForType, isHeicType } from '../media/sniff';
import { originalKey } from '../storage/keys';

/**
 * `GET /raw/<media path>/<versionId>`: that version's original, as uploaded. Only Safari can show a HEIC, which the
 * original's stored content type says it is, so one comes back as a full-size JPEG made on the way out, unless
 * `?format=original` asks for the file itself or the Images binding cannot decode it, when the file itself is the
 * best answer there is. The version is the key, so a file that was renamed is still found by an old URL; the path in
 * the URL is for whoever reads it, and names the download, with the extension the stored type gives it.
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
    const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream';
    const name = `${wanted.name}.${extensionForType(contentType)}`;
    if (!isHeicType(contentType) || url.searchParams.get('format') === 'original') {
        return file(object.body, contentType, name);
    }
    const bytes = await object.arrayBuffer();
    const jpeg = await asJpeg(env, bytes);
    return jpeg === null ? file(bytes, contentType, name) : file(jpeg, 'image/jpeg', `${wanted.name}.jpg`);
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
 * says how long its steps took, in Server-Timing and a log line, since a colo's first request is the slow one. The
 * cache is keyed by the URL with the format the client gets spelled into it, so two clients that accept different
 * formats never get each other's derivative from one URL.
 */
export async function derivedViaCacheApi(
    request: Request,
    env: Env,
    ctx: Pick<ExecutionContext, 'waitUntil'>,
): Promise<Response> {
    const wanted = derivation(request);
    if (wanted === null) {
        return badImageUrl();
    }
    const cache = caches.default;
    const cacheKey = keyedByFormat(request, wanted.format);
    const steps: Steps = {};
    const hit = await timed(steps, 'cache', async () => cache.match(cacheKey));
    if (hit) {
        const response = new Response(hit.body, hit);
        return reported(request, response, 'cache-api-hit', steps);
    }
    const derivative = await derivedImage(env, wanted, steps);
    if ('missing' in derivative) {
        return sourceNotFound(derivative.missing);
    }
    const response = new Response(derivative.body, {
        headers: { 'cache-control': IMMUTABLE, 'content-type': derivative.format, vary: 'Accept' },
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return reported(request, response, derivative.how, steps);
}

function keyedByFormat(request: Request, format: string): Request {
    const url = new URL(request.url);
    url.searchParams.set('format', format);
    return new Request(url, { method: 'GET' });
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

/** What the URL asks for and where its derivative and sources are, or null for a URL imageUrl would not write. */
function derivation(request: Request): Derivation | null {
    const url = new URL(request.url);
    const wanted = parseImageRequest(pathAfter(url, '/i'), url.searchParams);
    return wanted === null
        ? null
        : derivationFor(wanted, url.searchParams.get('format'), request.headers.get('accept'));
}

function sourceNotFound(key: string): Response {
    return notFound(`No source for ${key}`);
}

function badImageUrl(): Response {
    return failure(400, 'expected /i/<media path>/<versionId>?size=200x200&crop=x,y,width,height');
}
