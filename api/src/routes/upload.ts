import { json } from '../http/responses';
import { presign } from '../storage/s3';

/** Presigned PUT straight to R2's S3 endpoint, so upload bytes never pass through the Worker. */
export async function uploadUrl(request: Request, env: Env): Promise<Response> {
    const { path, contentType } = await request.json<{ path: string; contentType: string }>();
    const url = await presign(env, {
        method: 'PUT',
        bucket: env.MEDIA_BUCKET,
        key: `inbox/${path.replace(/^\//v, '')}`,
        contentType,
    });
    return json({ url, contentType });
}
