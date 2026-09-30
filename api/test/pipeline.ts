import {
    createExecutionContext,
    createMessageBatch,
    getQueueResult,
    introspectWorkflowInstance,
    waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { R2EventMessage } from '../src/gallery/upload';
import { inboxKey } from '../src/storage/keys';
import { handler } from './helpers';

function uploadEvent(versionId: string): R2EventMessage {
    return {
        action: 'PutObject',
        bucket: env.UPLOADS_BUCKET,
        object: { key: inboxKey(versionId) },
        eventTime: new Date().toISOString(),
    };
}

/** One batch of upload events, as the queue delivers them, with ids counting from 1. */
export function uploadBatch(versionIds: string[]): MessageBatch<R2EventMessage> {
    return createMessageBatch<R2EventMessage>(
        'staging-uploads',
        versionIds.map((versionId, index) => ({
            id: String(index + 1),
            timestamp: new Date(),
            attempts: 1,
            body: uploadEvent(versionId),
        })),
    );
}

type Introspector = Awaited<ReturnType<typeof introspectWorkflowInstance>>;
type Modify = Parameters<Introspector['modify']>[0];

interface Delivery {
    /** The status the pipeline instance is expected to end in. */
    until?: 'complete' | 'errored';
    /** Changes to the instance's behaviour, applied before it starts. */
    modify?: Modify;
    /** Bindings the consumer sees in place of the Worker's own, as `call` takes them. */
    bindings?: Partial<Env>;
}

/**
 * Delivers one upload event through the queue, waits for the pipeline instance it starts to end, and reports whether
 * the consumer acked the event.
 */
export async function deliver(
    versionId: string,
    { until = 'complete', modify, bindings = {} }: Delivery = {},
): Promise<string[]> {
    await using instance = await introspectWorkflowInstance(env.UPLOAD_PIPELINE, versionId);
    if (modify !== undefined) {
        await instance.modify(modify);
    }
    const batch = uploadBatch([versionId]);
    const ctx = createExecutionContext();
    await handler.queue?.(batch, { ...env, ...bindings }, ctx);
    await waitOnExecutionContext(ctx);
    await instance.waitForStatus(until);
    const result = await getQueueResult(batch, ctx);
    return result.explicitAcks;
}
