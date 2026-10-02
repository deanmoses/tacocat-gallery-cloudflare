import {
    createExecutionContext,
    getQueueResult,
    introspectWorkflowInstance,
    waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { parsePresigned } from '@tacocat-gallery/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import jpgDataUrl from '../../fixtures/FullMetadata.jpg?inline';
import { fixtureBytes } from '../gallery';
import { callAsAdmin, errorMessage, handler, putDay, storedItem, write } from '../helpers';
import { deliver, stage, uploadBatch } from '../pipeline';
import { testVersionId } from '../version-id';

const DAY = '/2024/06-15/';
const PATH = `${DAY}felix`;

const jpg = fixtureBytes(jpgDataUrl);

async function announce(versionId: string): Promise<Response> {
    return callAsAdmin(`/api/uploaded/${versionId}`, { method: 'POST' });
}

describe('announcing an upload', () => {
    beforeEach(async () => putDay(DAY));

    it('starts its pipeline at once, with no event from the bucket, and the upload becomes an item', async () => {
        const logged = vi.spyOn(console, 'info');
        const versionId = await stage(PATH, jpg);
        await using instance = await introspectWorkflowInstance(env.UPLOAD_PIPELINE, versionId);
        const response = await announce(versionId);
        await instance.waitForStatus('complete');

        expect(response.status).toBe(202);
        await expect(storedItem(DAY, 'felix')).resolves.toMatchObject({ versionId, title: 'My Image Title' });
        expect(logged).toHaveBeenCalledWith({
            event: 'upload_announced',
            versionId,
            started: true,
            delayMs: expect.any(Number) as number,
        });
    });

    it("acks the bucket's event that comes after it, and starts nothing", async () => {
        const versionId = await stage(PATH, jpg);
        // Held open, since disposing of it drops the instance.
        await using instance = await introspectWorkflowInstance(env.UPLOAD_PIPELINE, versionId);
        await announce(versionId);
        await instance.waitForStatus('complete');
        const logged = vi.spyOn(console, 'info');
        const batch = uploadBatch([versionId]);
        const ctx = createExecutionContext();
        await handler.queue?.(batch, env, ctx);
        await waitOnExecutionContext(ctx);

        await expect(getQueueResult(batch, ctx)).resolves.toHaveProperty('explicitAcks', ['1']);
        expect(logged).toHaveBeenCalledWith({ event: 'upload_redelivered', versionId });
    });

    it('starts nothing for an upload the event already finished', async () => {
        const versionId = await stage(PATH, jpg);
        await deliver(versionId);
        const started = vi.spyOn(env.UPLOAD_PIPELINE, 'create');
        const response = await announce(versionId);

        expect(response.status).toBe(202);
        expect(started).not.toHaveBeenCalled();
    });

    it('refuses a version nobody presigned, and one whose file has not arrived, starting nothing', async () => {
        const started = vi.spyOn(env.UPLOAD_PIPELINE, 'create');
        const presigned = await write('POST', `/api/presigned${DAY}`, [{ path: PATH, extension: 'jpg' }]);
        const versionId = parsePresigned(await presigned.json())[PATH]?.versionId ?? '';
        const unknown = await announce(testVersionId('v1'));
        const missing = await announce(versionId);
        const malformed = await announce('felix');

        expect(unknown.status).toBe(404);
        await expect(errorMessage(unknown)).resolves.toBe(`No upload [${testVersionId('v1')}]`);
        expect(missing.status).toBe(409);
        await expect(errorMessage(missing)).resolves.toBe(`The file of upload [${versionId}] has not arrived`);
        expect(malformed.status).toBe(404);
        expect(started).not.toHaveBeenCalled();
    });

    it('answers a retryable error, logged with the version, when the pipeline cannot start, and starts it on the retry', async () => {
        const failed = vi.spyOn(console, 'error');
        const versionId = await stage(PATH, jpg);
        vi.spyOn(env.UPLOAD_PIPELINE, 'create').mockRejectedValueOnce(new Error('Workflows unavailable'));
        const refused = await announce(versionId);

        expect(refused.status).toBe(503);
        await expect(errorMessage(refused)).resolves.toBe(
            "The upload's processing did not start: Error: Workflows unavailable",
        );
        expect(failed).toHaveBeenCalledWith({
            event: 'upload_announce_failed',
            versionId,
            error: 'Error: Workflows unavailable',
        });

        await using instance = await introspectWorkflowInstance(env.UPLOAD_PIPELINE, versionId);
        const retried = await announce(versionId);
        await instance.waitForStatus('complete');

        expect(retried.status).toBe(202);
        await expect(storedItem(DAY, 'felix')).resolves.toMatchObject({ versionId });
    });

    it('answers a retryable error when Workflows says the id is taken but no instance has it', async () => {
        const versionId = await stage(PATH, jpg);
        vi.spyOn(env.UPLOAD_PIPELINE, 'create').mockRejectedValueOnce(new Error('instance.already_exists'));
        const response = await announce(versionId);

        expect(response.status).toBe(503);
        await expect(errorMessage(response)).resolves.toMatch('instance.already_exists');
    });
});
