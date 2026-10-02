import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { mediaPath } from '@tacocat-gallery/shared';
import { eq } from 'drizzle-orm';
import { orm, schema } from '../db';
import { uploadErrorUpsert } from './errors';
import { type R2EventMessage, runUploadPipeline, uploadVersionOf } from './upload';

/** One upload's processing, as a Workflow instance whose id is the upload's version id. */
export class UploadPipeline extends WorkflowEntrypoint<Env, R2EventMessage> {
    override async run(event: WorkflowEvent<R2EventMessage>, step: WorkflowStep): Promise<void> {
        await runUploadPipeline(event.payload, this.env, step);
    }
}

/**
 * Starts the pipeline for an upload event. The instance is the version id, so R2 delivering the event again, as it
 * may, starts nothing: an upload is processed once however often it is announced. Whatever `create` answers, the
 * event is acked only once an instance by that id is found, since on 2026-10-01 the Workflows API reported a
 * production upload's id as taken that no instance had, for reasons Cloudflare does not document, and acking it lost
 * the upload; without one the failure is thrown and the queue delivers the event again.
 */
export async function startUploadPipeline(env: Pick<Env, 'UPLOAD_PIPELINE'>, event: R2EventMessage): Promise<void> {
    const versionId = uploadVersionOf(event);
    if (versionId === null) {
        return;
    }
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
    if (refusal !== null) {
        console.info({ event: 'upload_redelivered', versionId });
        return;
    }
    // How long R2's notification and the queue took to bring the event, which the admin waits through after the PUT.
    console.info({ event: 'upload_event_delivered', versionId, delayMs: Date.now() - Date.parse(event.eventTime) });
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
