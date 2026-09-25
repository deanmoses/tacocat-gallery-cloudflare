import { beforeEach, describe, expect, it, vi } from 'vitest';
import { albumRenameMachine } from './AlbumRenameMachine.svelte';
import { albumState } from '../AlbumState.svelte';
import { RenameStatus } from '$lib/models/album';
import { fakeServer, jsonResponse } from '$lib/test-support/http';
import { resetAlbumState, seedLoadedAlbum } from '$lib/test-support/albumState';
import { albumRecord } from '$lib/test-support/records';

const OLD_PATH = '/2001/12-31/';
const NEW_PATH = '/2001/12-30/';
const RENAME_ROUTE = '/api/album-rename/2001/12-31/';
const PARENT_ROUTE = '/api/album/2001/';

describe('albumRenameMachine', () => {
    beforeEach(() => {
        resetAlbumState();
        seedLoadedAlbum(albumRecord({ path: OLD_PATH, parentPath: '/2001/', itemName: '12-31' }));
    });

    // The page at the old path moves to the new one on seeing the rename landed, so that has to be visible while the
    // parent is re-read and gone once it has been
    it('records that the server renamed the album before re-reading its parent, and drops the rename after', async () => {
        const server = fakeServer();
        let statusWhileReReading: RenameStatus | undefined;
        server.post(RENAME_ROUTE, new Response(null, { status: 204 }));
        server.get(PARENT_ROUTE, () => {
            statusWhileReReading = albumState.albumRenames.get(OLD_PATH)?.status;
            return jsonResponse(albumRecord({ path: '/2001/', parentPath: '/', itemName: '2001' }));
        });

        albumRenameMachine.renameDayAlbum(OLD_PATH, NEW_PATH);

        await vi.waitFor(() => {
            expect(albumState.albumRenames.has(OLD_PATH)).toBe(false);
        });

        expect(statusWhileReReading).toBe(RenameStatus.RENAMED);
    });

    it('drops the rename, and keeps the album, when the server refuses', async () => {
        const server = fakeServer();
        server.post(RENAME_ROUTE, jsonResponse({ errorMessage: 'already exists' }, 400));

        albumRenameMachine.renameDayAlbum(OLD_PATH, NEW_PATH);

        await vi.waitFor(() => {
            expect(albumState.albumRenames.has(OLD_PATH)).toBe(false);
        });

        expect(server.calls).toHaveLength(1);
        expect(albumState.albums.get(OLD_PATH)?.album).toBeDefined();
    });
});
