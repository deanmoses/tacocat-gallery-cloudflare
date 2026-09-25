import * as valibot from 'valibot';
import { orm } from '../db';
import { recentUploadErrors } from '../gallery/errors';
import { failure, json } from '../http/responses';

const PATHS = valibot.object({ paths: valibot.array(valibot.string()) });

/** `POST /api/errors` with `{ paths }`: the last day's upload errors for those paths, keyed by path. */
export async function uploadErrors(request: Request, env: Pick<Env, 'DB'>): Promise<Response> {
    const body = valibot.safeParse(PATHS, await request.json());
    return body.success
        ? json({ errors: await recentUploadErrors(orm(env.DB), body.output.paths) })
        : failure(400, 'expected { paths: string[] }');
}
