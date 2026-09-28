import { API_BODIES } from '@tacocat-gallery/shared';
import { orm } from '../db';
import { recentUploadErrors } from '../gallery/errors';
import { json } from '../http/responses';
import { parsedBody } from '../http/body';

/** `POST /api/errors` with `{ paths }`: the last day's upload errors for those paths, keyed by path. */
export async function uploadErrors(request: Request, env: Pick<Env, 'DB'>): Promise<Response> {
    const body = await parsedBody(request, API_BODIES.uploadErrors);
    return 'response' in body
        ? body.response
        : json({ errors: await recentUploadErrors(orm(env.DB), body.output.paths) });
}
