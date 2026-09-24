import { pathAfter } from '../http/paths';
import { notFound } from '../http/responses';

/** Byte-range serving, which video playback and seeking depend on. */
export async function media(request: Request, env: Env): Promise<Response> {
    const key = pathAfter(new URL(request.url), '/v/');
    const object = await env.MEDIA.get(key, { range: request.headers });
    if (!object) {
        return notFound();
    }
    const headers = new Headers({ 'accept-ranges': 'bytes', etag: object.httpEtag });
    object.writeHttpMetadata(headers);
    if (request.headers.has('range') && object.range && 'offset' in object.range) {
        const start = object.range.offset ?? 0;
        const end = start + (object.range.length ?? object.size - start) - 1;
        headers.set('content-range', `bytes ${start}-${end}/${object.size}`);
        return new Response(object.body, { status: 206, headers });
    }
    return new Response(object.body, { headers });
}
