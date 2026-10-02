import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadMachine } from './UploadMachine.svelte';
import { albumState } from '../AlbumState.svelte';
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
    });
});
