import { pathAfter } from '../http/paths';
import { json } from '../http/responses';
import { presign } from '../storage/presign';

/**
 * Stand-in for the browser's presigned PUT: writes straight to R2 so the event notification path can be
 * exercised before S3 API credentials exist.
 */
export async function upload(request: Request, env: Env): Promise<Response> {
    const key = pathAfter(new URL(request.url), '/upload/');
    const contentType = request.headers.get('content-type');
    const object = await env.MEDIA.put(`inbox/${key}`, request.body, {
        httpMetadata: contentType === null ? {} : { contentType },
    });
    return json({ key: object.key, size: object.size });
}

/** Presigned PUT straight to R2's S3 endpoint, so upload bytes never pass through the Worker. */
export async function uploadUrl(request: Request, env: Env): Promise<Response> {
    const { path, contentType } = await request.json<{ path: string; contentType: string }>();
    const url = await presign(env, { method: 'PUT', key: `inbox/${path.replace(/^\//v, '')}`, contentType });
    return json({ url, contentType });
}
