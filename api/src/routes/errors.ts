import * as valibot from 'valibot';
import { orm } from '../db';
import { recentUploadErrors } from '../gallery/errors';
import { json } from '../http/responses';
import { parsedBody } from './requests';

const PATHS = valibot.object({ paths: valibot.array(valibot.string()) });

/** `POST /api/errors` with `{ paths }`: the last day's upload errors for those paths, keyed by path. */
export async function uploadErrors(request: Request, env: Pick<Env, 'DB'>): Promise<Response> {
    const body = await parsedBody(request, PATHS);
    return 'response' in body
        ? body.response
        : json({ errors: await recentUploadErrors(orm(env.DB), body.output.paths) });
}
