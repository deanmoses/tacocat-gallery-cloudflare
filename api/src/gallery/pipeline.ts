import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { mediaPath } from '@tacocat-gallery/shared';
import { eq } from 'drizzle-orm';
import { orm, schema } from '../db';
import { originalKey } from '../storage/keys';
import { uploadErrorUpsert } from './errors';
import { type R2EventMessage, runUploadPipeline, uploadVersionOf } from './upload';

/** One upload's processing, as a Workflow instance whose id is the upload's version id. */
export class UploadPipeline extends WorkflowEntrypoint<Env, R2EventMessage> {
    override async run(event: WorkflowEvent<R2EventMessage>, step: WorkflowStep): Promise<void> {
        await runUploadPipeline(event.payload, this.env, step);
    }
}

/**
 * Starts the pipeline for an upload event, which R2 raises when the original lands. The uploader announces the upload
 * itself as soon as its PUT succeeds, so the event is the backstop for an announcement that never came, as from a tab
 * closed in between; whichever comes second finds the instance and starts nothing. A failure is thrown, and the queue
 * delivers the event again.
 */
export async function startUploadPipeline(env: Pick<Env, 'UPLOAD_PIPELINE'>, event: R2EventMessage): Promise<void> {
    const versionId = uploadVersionOf(event);
    if (versionId === null) {
        return;
    }
    let started: boolean;
    try {
        started = await startInstance(env, versionId, event);
    } catch (error) {
        console.error({ event: 'upload_event_failed', versionId, error: String(error) });
        throw error;
    }
    if (!started) {
        console.info({ event: 'upload_redelivered', versionId });
        return;
    }
    // How long R2's notification and the queue took to bring the event, which the admin waits through after the PUT.
    console.info({ event: 'upload_event_delivered', versionId, delayMs: Date.now() - Date.parse(event.eventTime) });
}

export type Announced = 'started' | 'finished' | 'unknown' | 'missing';

/**
 * Starts the pipeline for an upload its uploader says it has put, without waiting for R2's event, whose delay is
 * seconds as a rule and has been minutes. Nothing is started for a version nobody presigned, one already finished, or
 * one whose original is not there, since an instance started without it would end having done nothing and use up the
 * version id. A failure to start is thrown, for the uploader to try again.
 */
export async function announceUpload(
    env: Pick<Env, 'DB' | 'ORIGINALS' | 'ORIGINALS_BUCKET' | 'UPLOAD_PIPELINE'>,
    versionId: string,
): Promise<Announced> {
    const upload = await orm(env.DB)
        .select({ completedAt: schema.upload.completedAt })
        .from(schema.upload)
        .where(eq(schema.upload.versionId, versionId))
        .get();
    if (upload === undefined) {
        return 'unknown';
    }
    if (upload.completedAt !== null) {
        return 'finished';
    }
    const key = originalKey(versionId);
    const original = await env.ORIGINALS.head(key);
    if (original === null) {
        return 'missing';
    }
    // The message R2's notification carries, so an instance runs the same whichever started it.
    const event: R2EventMessage = {
        action: 'PutObject',
        bucket: env.ORIGINALS_BUCKET,
        object: { key, size: original.size, eTag: original.etag },
        eventTime: original.uploaded.toISOString(),
    };
    let started: boolean;
    try {
        started = await startInstance(env, versionId, event);
    } catch (error) {
        console.error({ event: 'upload_announce_failed', versionId, error: String(error) });
        throw error;
    }
    // How long after the original landed its uploader's word came, against the event's delay.
    console.info({ event: 'upload_announced', versionId, started, delayMs: Date.now() - original.uploaded.getTime() });
    return 'started';
}

/**
 * Creates the instance named by the version id, and says whether this call made it. Whatever `create` answers, an
 * instance by that id has to be found after, since on 2026-10-01 the Workflows API reported a production upload's id
 * as taken that no instance had, for reasons Cloudflare does not document, and taking its word lost the upload;
 * without one the failure is thrown.
 */
async function startInstance(
    env: Pick<Env, 'UPLOAD_PIPELINE'>,
    versionId: string,
    event: R2EventMessage,
): Promise<boolean> {
    let refusal: unknown = null;
    try {
        await env.UPLOAD_PIPELINE.create({ id: versionId, params: event });
    } catch (error) {
        refusal = error;
    }
    try {
        await env.UPLOAD_PIPELINE.get(versionId);
    } catch (error) {
        throw refusal ?? error;
    }
    return refusal === null;
}

export const UNSTARTED_ERROR = 'the upload was never processed, so upload the file again';

/**
 * Tells the admin about an upload whose event spent its retries without starting a pipeline, by an upload error at
 * its path. The dead-letter message is consumed, so uploading the file again is the way back.
 */
export async function reportUnstartedUpload(
    env: Pick<Env, 'DB' | 'UPLOAD_PIPELINE'>,
    event: R2EventMessage,
): Promise<void> {
    const versionId = uploadVersionOf(event);
    if (versionId === null) {
        return;
    }
    const database = orm(env.DB);
    const upload = await database.select().from(schema.upload).where(eq(schema.upload.versionId, versionId)).get();
    // Nobody presigned it, or it finished after all.
    if (upload?.completedAt !== null) {
        return;
    }
    // An instance did start, whose answer was lost or which is still running, as a long transcode may be: it will
    // land or record its own error.
    try {
        await env.UPLOAD_PIPELINE.get(versionId);
        return;
    } catch {
        // No instance, so nothing else will tell the admin.
    }
    const path = mediaPath(upload.parentPath, upload.itemName);
    // Logged before the write, so an upload whose report fails every retry still leaves a trace.
    console.error({ event: 'upload_unstarted', path, versionId });
    await uploadErrorUpsert(database, path, UNSTARTED_ERROR).run();
}
