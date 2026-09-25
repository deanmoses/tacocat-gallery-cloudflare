import { currentAdmin } from '../auth/passkeys';
import { acceptLocalUpload } from '../gallery/local';
import { failure, notFound } from '../http/responses';

const VERSION_ID = /^[\w\-.]+$/v;

/**
 * `PUT /upload/<versionId>` under `wrangler dev`, the URL presign hands out there in place of a signed one: the file
 * goes into the local bucket and its event onto the local queue. Deployed, the path is not there.
 */
export async function localUploadRoute(request: Request, env: Env, versionId: string): Promise<Response> {
    if (env.UPLOADS !== 'local' || !VERSION_ID.test(versionId)) {
        return notFound();
    }
    if ((await currentAdmin(request, env)) === null) {
        return failure(401, 'Unauthorized');
    }
    await acceptLocalUpload(env, versionId, await request.arrayBuffer(), request.headers.get('content-type'));
    return new Response(null, { status: 200 });
}
