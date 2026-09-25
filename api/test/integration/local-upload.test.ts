import {
    createExecutionContext,
    createMessageBatch,
    introspectWorkflowInstance,
    waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { parsePresigned } from 'tacocat-gallery-shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import jpgDataUrl from '../../fixtures/FullMetadata.jpg?inline';
import type { R2EventMessage } from '../../src/gallery/upload';
import handler from '../../src/index';
import { inboxKey } from '../../src/storage/keys';
import { call, callAsAdmin, parseExactly, putItem, storedItem } from '../helpers';

const DAY = '/2024/06-15/';
const PATH = `${DAY}felix.jpg`;
const LOCAL = { UPLOADS: 'local' } as const;

const jpg = Uint8Array.fromBase64(jpgDataUrl.slice(jpgDataUrl.indexOf(',') + 1));

/** Asks for one upload URL as the app does, under the given bindings. */
async function presignOne(bindings: Partial<Env>): Promise<{ url: string; versionId: string }> {
    const response = await callAsAdmin(
        `/api/presigned${DAY}`,
        { method: 'POST', body: JSON.stringify([{ path: PATH }]) },
        bindings,
    );
    const presigned = (await parseExactly(response, parsePresigned))[PATH];
    if (presigned === undefined) {
        throw new Error('nothing presigned');
    }
    return presigned;
}

// Under wrangler dev the browser's PUT cannot reach the account's bucket and no real queue can reach the Worker, so
// the Worker takes the PUT itself and raises the event; deployed, neither the URL nor the route exists.
describe('local uploads', () => {
    beforeEach(async () => {
        await putItem({ parentPath: '/', itemName: '2024', itemType: 'album' });
        await putItem({ parentPath: '/2024/', itemName: '06-15', itemType: 'album' });
    });

    it('are not there unless switched on: the URL is signed and the route is missing', async () => {
        const { url } = await presignOne({});
        const response = await callAsAdmin('/upload/v1', { method: 'PUT', body: jpg });

        expect(url).toMatch(/^https:\/\//v);
        expect(response.status).toBe(404);
    });

    it('are presigned to the Worker itself, which needs an admin', async () => {
        const { url, versionId } = await presignOne(LOCAL);
        const response = await callAsAdmin(url, { method: 'PUT', body: jpg }, LOCAL);
        const guest = await call(url, { method: 'PUT', body: jpg }, LOCAL);

        expect(url).toBe(`/upload/${versionId}`);
        expect(response.status).toBe(200);
        expect(guest.status).toBe(401);
    });

    it('put the file in the inbox and raise the event R2 would, which the pipeline turns into the item', async () => {
        const sent = vi.spyOn(env.UPLOAD_EVENTS, 'send');
        const { url, versionId } = await presignOne(LOCAL);
        await callAsAdmin(url, { method: 'PUT', body: jpg, headers: { 'content-type': 'image/jpeg' } }, LOCAL);
        const object = await env.MEDIA.get(inboxKey(versionId));

        expect(object?.httpMetadata?.contentType).toBe('image/jpeg');
        expect(object?.size).toBe(jpg.byteLength);
        expect(sent).toHaveBeenCalledExactlyOnceWith({
            action: 'PutObject',
            bucket: env.MEDIA_BUCKET,
            object: { key: inboxKey(versionId), size: jpg.byteLength, eTag: expect.any(String) },
            eventTime: expect.any(String),
        });

        const event: R2EventMessage = {
            action: 'PutObject',
            bucket: env.MEDIA_BUCKET,
            object: { key: inboxKey(versionId) },
            eventTime: new Date().toISOString(),
        };
        const batch = createMessageBatch<R2EventMessage>('tacocat-staging-uploads', [
            { id: '1', timestamp: new Date(), attempts: 1, body: event },
        ]);
        await using instance = await introspectWorkflowInstance(env.UPLOAD_PIPELINE, versionId);
        const ctx = createExecutionContext();
        await handler.queue(batch, { ...env, ...LOCAL });
        await waitOnExecutionContext(ctx);
        await instance.waitForStatus('complete');

        await expect(storedItem(DAY, 'felix.jpg')).resolves.toMatchObject({ versionId, title: 'My Image Title' });
    });
});
