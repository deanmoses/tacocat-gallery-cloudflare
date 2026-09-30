import { env } from 'cloudflare:workers';
import { parsePresigned } from '@tacocat-gallery/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import jpgDataUrl from '../../fixtures/FullMetadata.jpg?inline';
import { inboxKey } from '../../src/storage/keys';
import { fixtureBytes } from '../gallery';
import { call, callAsAdmin, parseExactly, putDay, storedItem } from '../helpers';
import { deliver } from '../pipeline';
import { testVersionId } from '../version-id';

const DAY = '/2024/06-15/';
const PATH = `${DAY}felix`;
const LOCAL = { UPLOAD_MODE: 'local' } as const;

const jpg = fixtureBytes(jpgDataUrl);

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
        await putDay(DAY);
    });

    it('are not there unless switched on: the URL is signed and the route is missing', async () => {
        const { url } = await presignOne({});
        const response = await callAsAdmin(`/upload/${testVersionId('v1')}`, { method: 'PUT', body: jpg });

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
        const object = await env.UPLOADS.get(inboxKey(versionId));

        expect(object?.httpMetadata?.contentType).toBe('image/jpeg');
        expect(object?.size).toBe(jpg.byteLength);
        expect(sent).toHaveBeenCalledExactlyOnceWith({
            action: 'PutObject',
            bucket: env.UPLOADS_BUCKET,
            object: { key: inboxKey(versionId), size: jpg.byteLength, eTag: expect.any(String) },
            eventTime: expect.any(String),
        });

        await deliver(versionId, { bindings: LOCAL });

        await expect(storedItem(DAY, 'felix')).resolves.toMatchObject({ versionId, title: 'My Image Title' });
    });
});
