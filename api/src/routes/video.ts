import { parseMediaVersion } from 'tacocat-gallery-shared';
import { pathAfter } from '../http/paths';
import { failure, notFound } from '../http/responses';
import { IMMUTABLE } from '../media/images';
import { videoKey } from '../storage/keys';

/**
 * `GET /v/<media path>/<versionId>`: the MP4 the transcoder wrote for that version, with byte ranges, which playback
 * and seeking depend on. The version is the key; the path in the URL is for whoever reads it. Kept for a year, since
 * the URL names one version.
 */
export async function media(request: Request, env: Env): Promise<Response> {
    const wanted = parseMediaVersion(pathAfter(new URL(request.url), '/v'));
    if (wanted === null) {
        return failure(400, 'expected /v/<media path>/<versionId>');
    }
    const key = videoKey(wanted.versionId);
    const asked = askedRange(request.headers.get('range'));
    let object: R2ObjectBody | null;
    try {
        object = await env.DERIVED.get(key, asked === null ? undefined : { range: request.headers });
    } catch (error) {
        // R2 refuses a range that lies outside the object, which is a 416 as long as the object exists.
        const whole = await env.DERIVED.head(key);
        if (whole === null) {
            return notFound();
        }
        console.info({ event: 'video_range_unsatisfiable', key, error: String(error) });
        return unsatisfiable(whole.size);
    }
    if (object === null) {
        return notFound();
    }
    const headers = new Headers({ 'accept-ranges': 'bytes', etag: object.httpEtag, 'cache-control': IMMUTABLE });
    object.writeHttpMetadata(headers);
    if (asked === null) {
        return new Response(object.body, { headers });
    }
    const range = resolveRange(asked, object.size);
    if (range === null) {
        return unsatisfiable(object.size);
    }
    headers.set('content-range', `bytes ${range.start}-${range.end}/${object.size}`);
    return new Response(object.body, { status: 206, headers });
}

function unsatisfiable(size: number): Response {
    return failure(416, 'Range Not Satisfiable', { 'content-range': `bytes */${size}` });
}

const RANGE = /^bytes=(?<start>\d*)-(?<end>\d*)$/v;

/** One byte range as a Range header asks for it, or null when there is no header or it asks for something else. */
function askedRange(header: string | null): { start: number | null; end: number | null } | null {
    const match = header === null ? null : RANGE.exec(header.trim());
    const start = match?.groups?.['start'];
    const end = match?.groups?.['end'];
    if (start === undefined || end === undefined || (start === '' && end === '')) {
        return null;
    }
    return { start: start === '' ? null : Number(start), end: end === '' ? null : Number(end) };
}

/**
 * The bytes of an object `size` long that the range names, clamped to the object; null when it names none of them,
 * which is what R2 was asked for and what the response has to say. A range with no start is a suffix: the last so
 * many bytes, which a player asks for to find the index at the end of an MP4.
 */
function resolveRange(
    asked: { start: number | null; end: number | null },
    size: number,
): { start: number; end: number } | null {
    if (asked.start === null) {
        const suffix = asked.end ?? 0;
        return suffix === 0 ? null : { start: Math.max(size - suffix, 0), end: size - 1 };
    }
    return asked.start >= size || (asked.end !== null && asked.end < asked.start)
        ? null
        : { start: asked.start, end: Math.min(asked.end ?? size - 1, size - 1) };
}
