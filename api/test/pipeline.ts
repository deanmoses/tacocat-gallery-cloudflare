import {
    createExecutionContext,
    createMessageBatch,
    getQueueResult,
    introspectWorkflowInstance,
    waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { parentPathOf, parsePresigned } from '@tacocat-gallery/shared';
import type { R2EventMessage } from '../src/gallery/upload';
import { originalKey } from '../src/storage/keys';
import { handler, write } from './helpers';

export interface Staged {
    replace?: boolean;
    /** The extension of the file's name, which decides the type it is stored as. */
    extension?: string;
}

/**
 * Asks for an upload URL as the app does and puts the file where the browser's PUT would, as the type the URL was
 * signed with, returning the version id the upload was minted, ready for its event to be delivered.
 */
export async function stage(
    path: string,
    file: Uint8Array,
    { replace, extension = 'jpg' }: Staged = {},
): Promise<string> {
    const response = await write('POST', `/api/presigned${parentPathOf(path)}`, [
        { path, extension, ...(replace === undefined ? {} : { replace }) },
    ]);
    if (!response.ok) {
        throw new Error(`presign refused: ${await response.text()}`);
    }
    const presigned = parsePresigned(await response.json())[path];
    if (presigned === undefined) {
        throw new Error(`nothing presigned for ${path}`);
    }
    await env.ORIGINALS.put(originalKey(presigned.versionId), file, {
        httpMetadata: { contentType: presigned.contentType },
    });
    return presigned.versionId;
}

function uploadEvent(versionId: string): R2EventMessage {
    return {
        action: 'PutObject',
        bucket: env.ORIGINALS_BUCKET,
        object: { key: originalKey(versionId) },
        eventTime: new Date().toISOString(),
    };
}

/** One batch of upload events, as the queue delivers them, with ids counting from 1. */
export function uploadBatch(versionIds: string[], queue = 'staging-uploads'): MessageBatch<R2EventMessage> {
    return createMessageBatch<R2EventMessage>(
        queue,
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
