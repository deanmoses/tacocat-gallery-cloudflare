import { inboxKey } from '../storage/keys';
import type { R2EventMessage } from './upload';

export type LocalUploadEnv = Pick<Env, 'MEDIA' | 'MEDIA_BUCKET' | 'UPLOAD_EVENTS'>;

/**
 * Takes an upload the way the bucket would under `wrangler dev`, where the browser's PUT cannot reach the account's
 * bucket and no real queue can reach a local Worker: the file goes into the local bucket's inbox, and the queue gets
 * the message R2's event notification would have carried, so the pipeline runs on it unchanged.
 */
export async function acceptLocalUpload(
    env: LocalUploadEnv,
    versionId: string,
    file: ArrayBuffer,
    contentType: string | null,
): Promise<void> {
    const key = inboxKey(versionId);
    const object = await env.MEDIA.put(key, file, { httpMetadata: contentType === null ? {} : { contentType } });
    const event: R2EventMessage = {
        action: 'PutObject',
        bucket: env.MEDIA_BUCKET,
        object: { key, size: object.size, eTag: object.etag },
        eventTime: new Date().toISOString(),
    };
    await env.UPLOAD_EVENTS.send(event);
}
