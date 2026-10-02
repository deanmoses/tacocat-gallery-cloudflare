import { API, isVersionId } from '@tacocat-gallery/shared';
import { type Announced, announceUpload } from '../gallery/pipeline';
import { pathAfter } from '../http/paths';
import { failure, notFound } from '../http/responses';

/**
 * `POST /api/uploaded/<versionId>`, sent once the upload's PUT has succeeded: its processing starts, and a 202 means
 * it will finish whatever the uploader does next. A 503 is worth retrying.
 */
export async function uploadedRoute(request: Request, env: Env): Promise<Response> {
    const versionId = pathAfter(new URL(request.url), `${API.uploaded.prefix}/`);
    if (!isVersionId(versionId)) {
        return notFound();
    }
    let announced: Announced;
    try {
        announced = await announceUpload(env, versionId);
    } catch (error) {
        return failure(503, `The upload's processing did not start: ${String(error)}`);
    }
    if (announced === 'unknown') {
        return notFound(`No upload [${versionId}]`);
    }
    return announced === 'missing'
        ? failure(409, `The file of upload [${versionId}] has not arrived`)
        : new Response(null, { status: 202 });
}
