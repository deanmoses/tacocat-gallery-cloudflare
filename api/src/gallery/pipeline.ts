import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { type R2EventMessage, runUploadPipeline, uploadVersionOf } from './upload';

/** One upload's processing, as a Workflow instance whose id is the upload's version id. */
export class UploadPipeline extends WorkflowEntrypoint<Env, R2EventMessage> {
    override async run(event: WorkflowEvent<R2EventMessage>, step: WorkflowStep): Promise<void> {
        await runUploadPipeline(event.payload, this.env, step);
    }
}

/**
 * Starts the pipeline for an upload event. The instance is the version id, and a batch create skips an id that is
 * taken, so R2 delivering the event again, as it may, starts nothing: an upload is processed once however often it
 * is announced.
 */
export async function startUploadPipeline(env: Pick<Env, 'UPLOAD_PIPELINE'>, event: R2EventMessage): Promise<void> {
    const versionId = uploadVersionOf(event);
    if (versionId === null) {
        return;
    }
    const started = await env.UPLOAD_PIPELINE.createBatch([{ id: versionId, params: event }]);
    if (started.length === 0) {
        console.info({ event: 'upload_redelivered', versionId });
    }
}
