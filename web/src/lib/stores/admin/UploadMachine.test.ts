import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadMachine } from './UploadMachine.svelte';
import { albumState } from '../AlbumState.svelte';
import { UploadState } from '$lib/models/album';
import { fakeServer, jsonResponse } from '$lib/test-support/http';
import { resetAlbumState } from '$lib/test-support/albumState';
import { albumRecord, imageRecord, mediaPath } from '$lib/test-support/records';

const PATH = mediaPath('felix');

describe('uploadMachine', () => {
    beforeEach(() => {
        resetAlbumState();
        vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('sees within half a second of the PUT that the server has made the upload an item', async () => {
        const server = fakeServer();
        server.post(
            '/api/presigned/2001/12-31/',
            jsonResponse({ [PATH]: { url: '/originals/v2', contentType: 'image/heic', versionId: 'v2' } }),
        );
        server.put('/originals/v2', new Response(null, { status: 200 }));
        server.post('/api/uploaded/v2', new Response(null, { status: 202 }));
        server.post('/api/errors', jsonResponse({ errors: {} }));
        server.get(
            '/api/album/2001/12-31/',
            jsonResponse(
                albumRecord({
                    path: '/2001/12-31/',
                    itemName: '12-31',
                    children: [imageRecord({ path: PATH, itemName: 'felix', versionId: 'v2' })],
                }),
            ),
        );

        // A HEIC, which the upload does not try to decode in the page first
        uploadMachine.uploadMediaItem(PATH, new File(['bytes'], 'Felix.HEIC', { type: 'image/heic' }));
        await vi.advanceTimersByTimeAsync(600);

        expect(albumState.uploads).toStrictEqual([]);
        expect(server.calls[0]).toStrictEqual({
            method: 'POST',
            pathname: '/api/presigned/2001/12-31/',
            body: [{ path: PATH, extension: 'heic' }],
        });
        expect(server.calls.slice(1, 3)).toStrictEqual([
            { method: 'PUT', pathname: '/originals/v2', body: undefined },
            { method: 'POST', pathname: '/api/uploaded/v2', body: undefined },
        ]);
    });

    it('reports an upload whose processing never started, and stops waiting for it', async () => {
        const server = fakeServer();
        server.post(
            '/api/presigned/2001/12-31/',
            jsonResponse({ [PATH]: { url: '/originals/v2', contentType: 'image/heic', versionId: 'v2' } }),
        );
        server.put('/originals/v2', new Response(null, { status: 200 }));
        server.post('/api/uploaded/v2', jsonResponse({ errorMessage: 'Workflows unavailable' }, 503));
        const failed = vi.spyOn(console, 'error');

        uploadMachine.uploadMediaItem(PATH, new File(['bytes'], 'Felix.HEIC', { type: 'image/heic' }));
        await vi.advanceTimersByTimeAsync(5000);

        expect(albumState.uploads).toStrictEqual([]);
        expect(failed).toHaveBeenCalledWith(
            `Error uploading [${PATH}]: uploaded, but processing did not start: Workflows unavailable`,
        );
        expect(server.calls.filter((call) => call.pathname === '/api/uploaded/v2')).toHaveLength(3);
    });

    it('shows each item as soon as the server has made it, while a slower file is still uploading', async () => {
        const TABBY = mediaPath('tabby');
        let tabbyDone = false;
        const server = fakeServer();
        server.post(
            '/api/presigned/2001/12-31/',
            jsonResponse({
                [PATH]: { url: '/originals/v2', contentType: 'image/heic', versionId: 'v2' },
                [TABBY]: { url: '/originals/v3', contentType: 'image/heic', versionId: 'v3' },
            }),
        );
        server.put('/originals/v2', new Response(null, { status: 200 }));
        server.put(
            '/originals/v3',
            async () =>
                new Promise((resolve) => {
                    setTimeout(() => {
                        resolve(new Response(null, { status: 200 }));
                    }, 10_000);
                }),
        );
        server.post('/api/uploaded/v2', new Response(null, { status: 202 }));
        server.post('/api/uploaded/v3', new Response(null, { status: 202 }));
        server.post('/api/errors', jsonResponse({ errors: {} }));
        server.get('/api/album/2001/12-31/', () => {
            const children = [imageRecord({ path: PATH, itemName: 'felix', versionId: 'v2' })];
            if (tabbyDone) children.push(imageRecord({ path: TABBY, itemName: 'tabby', versionId: 'v3' }));
            return jsonResponse(albumRecord({ path: '/2001/12-31/', itemName: '12-31', children }));
        });

        uploadMachine.uploadMediaItems('/2001/12-31/', [
            { path: PATH, file: new File(['bytes'], 'Felix.HEIC', { type: 'image/heic' }) },
            { path: TABBY, file: new File(['bytes'], 'Tabby.HEIC', { type: 'image/heic' }) },
        ]);
        await vi.advanceTimersByTimeAsync(2000);

        expect(albumState.uploads.map(({ path, status }) => ({ path, status }))).toStrictEqual([
            { path: TABBY, status: UploadState.UPLOADING },
        ]);

        tabbyDone = true;
        await vi.advanceTimersByTimeAsync(12_000);

        expect(albumState.uploads).toStrictEqual([]);
    });
});
