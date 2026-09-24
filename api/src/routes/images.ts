import { pathAfter } from '../http/paths';
import { json, notFound } from '../http/responses';
import { type Derivative, IMMUTABLE, type Steps, derivedImage, derivedKey, timed } from '../media/images';

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
    const wanted = derivedKey(new URL(request.url), '/i');
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
    const derivative = await derivedImage(env, wanted, {});
    return 'missing' in derivative ? sourceNotFound(derivative.missing) : generated(derivative);
}

function generated(derivative: Derivative): Response {
    return new Response(derivative.body, {
        headers: { 'cache-control': IMMUTABLE, 'content-type': derivative.format, 'x-derived': derivative.how },
    });
}

function sourceNotFound(key: string): Response {
    return json({ error: 'source not found', key }, 404);
}

function badImageUrl(): Response {
    return json({ error: 'expected /i/<media path>/<versionId>?size=200x200&crop=x,y,width,height' }, 400);
}
