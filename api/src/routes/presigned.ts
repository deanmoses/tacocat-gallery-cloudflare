import { isDayAlbumPath, presignRequestSchema } from 'tacocat-gallery-shared';
import { currentAdmin } from '../auth/passkeys';
import { orm } from '../db';
import { presignUploads } from '../gallery/presign';
import { pathAfter } from '../http/paths';
import { failure, json } from '../http/responses';
import { parsedBody } from './requests';

/**
 * `POST /api/presigned/<albumPath>` with what each upload will be: a presigned PUT and a version id per path, keyed by
 * path as the app reads them.
 */
export async function presignRoute(request: Request, env: Env): Promise<Response> {
    const albumPath = `/${pathAfter(new URL(request.url), '/api/presigned/')}`;
    if (!isDayAlbumPath(albumPath)) {
        return failure(400, `Invalid day album path [${albumPath}]`);
    }
    const body = await parsedBody(request, presignRequestSchema);
    if ('response' in body) {
        return body.response;
    }
    const admin = await currentAdmin(request, env);
    if (admin === null) {
        return failure(401, 'Unauthorized');
    }
    const result = await presignUploads(env, orm(env.DB.withSession('first-primary')), albumPath, body.output, admin);
    return 'refused' in result
        ? failure(400, result.refused)
        : json(result.uploads, 200, { 'x-d1': `rows=${String(result.rowsRead)}` });
}
