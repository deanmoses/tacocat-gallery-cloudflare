import { parseMediaVersion } from 'tacocat-gallery-shared';
import { pathAfter } from '../http/paths';
import { failure, notFound } from '../http/responses';
import { videoKey } from '../storage/keys';

/**
 * `GET /v/<media path>/<versionId>`: the MP4 the transcoder wrote for that version, with byte ranges, which playback
 * and seeking depend on. The version is the key; the path in the URL is for whoever reads it.
 */
export async function media(request: Request, env: Env): Promise<Response> {
    const wanted = parseMediaVersion(pathAfter(new URL(request.url), '/v'));
    if (wanted === null) {
        return failure(400, 'expected /v/<media path>/<versionId>');
    }
    const object = await env.DERIVED.get(videoKey(wanted.versionId), { range: request.headers });
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
