import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mediaRenameMachine } from './MediaRenameMachine.svelte';
import { albumState } from '../AlbumState.svelte';
import { RenameStatus } from '$lib/models/album';
import { fakeServer, jsonResponse } from '$lib/test-support/http';
import { resetAlbumState, seedLoadedAlbum } from '$lib/test-support/albumState';
import { albumRecord, imageRecord, mediaPath } from '$lib/test-support/records';

const ALBUM_PATH = '/2001/12-31/';
const ALBUM_ROUTE = '/api/album/2001/12-31/';
const OLD_PATH = mediaPath('image.jpg');
const NEW_PATH = mediaPath('renamed.jpg');
const RENAME_ROUTE = '/api/media-rename/2001/12-31/image.jpg';

function album(itemName: string): ReturnType<typeof albumRecord> {
    return albumRecord({
        path: ALBUM_PATH,
        parentPath: '/2001/',
        itemName: '12-31',
        children: [imageRecord({ path: mediaPath(itemName), itemName })],
    });
}

describe('mediaRenameMachine', () => {
    beforeEach(() => {
        resetAlbumState();
        seedLoadedAlbum(album('image.jpg'));
    });

    // The page at the old path moves to the new one on seeing the rename landed, so that has to be visible while the
    // album is re-read and gone once it has been
    it('records that the server renamed the item before re-reading the album, and drops the rename after', async () => {
        const server = fakeServer();
        let statusWhileReReading: RenameStatus | undefined;
        server.post(RENAME_ROUTE, new Response(null, { status: 204 }));
        server.get(ALBUM_ROUTE, () => {
            statusWhileReReading = albumState.mediaRenames.get(OLD_PATH)?.status;
            return jsonResponse(album('renamed.jpg'));
        });

        mediaRenameMachine.renameMediaItem(OLD_PATH, NEW_PATH);

        await vi.waitFor(() => {
            expect(albumState.mediaRenames.has(OLD_PATH)).toBe(false);
        });

        expect(statusWhileReReading).toBe(RenameStatus.RENAMED);
        expect(albumState.albums.get(ALBUM_PATH)?.album?.getMedia(NEW_PATH)).toBeDefined();
    });

    it('drops the rename, and leaves the album as it was, when the server refuses', async () => {
        const server = fakeServer();
        server.post(RENAME_ROUTE, jsonResponse({ errorMessage: 'A media item already exists' }, 400));

        mediaRenameMachine.renameMediaItem(OLD_PATH, NEW_PATH);

        await vi.waitFor(() => {
            expect(server.calls).toHaveLength(1);
        });
        await vi.waitFor(() => {
            expect(albumState.mediaRenames.has(OLD_PATH)).toBe(false);
        });

        expect(albumState.albums.get(ALBUM_PATH)?.album?.getMedia(OLD_PATH)).toBeDefined();
    });
});
