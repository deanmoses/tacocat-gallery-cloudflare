import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { draftMachine } from './DraftMachine.svelte';
import { DraftStatus } from '$lib/models/draft';
import { albumState } from '../AlbumState.svelte';
import { clear as clearDisk, get as getFromDisk } from 'idb-keyval';
import { fakeServer, jsonResponse, serverError } from '$lib/test-support/http';
import { resetAlbumState, seedLoadedAlbum } from '$lib/test-support/albumState';
import { albumRecord, imageRecord } from '$lib/test-support/records';
import type { AlbumGalleryItem } from '$lib/models/impl/server';
import { getMedia } from '$lib/utils/albumNavigation';

/**
 * draftMachine is a module singleton, so each test starts by initialising it
 * rather than by constructing one.
 */
const ALBUM_PATH = '/2001/12-31/';
const MEDIA_PATH = '/2001/12-31/image';
const ALBUM_ROUTE = '/api/album/2001/12-31/';
const MEDIA_ROUTE = '/api/media/2001/12-31/image';

function album(): AlbumGalleryItem {
    return albumRecord({
        path: ALBUM_PATH,
        parentPath: '/2001/',
        itemName: '12-31',
        description: 'Old album description',
        children: [imageRecord({ path: MEDIA_PATH, itemName: 'image', description: 'Old image description' })],
    });
}

/** A reply the spec sends when it is ready, so it can look at the store while the request is out */
function heldReply(): { reply: () => Promise<Response>; send: (response: Response) => void } {
    const { promise, resolve } = Promise.withResolvers<Response>();
    return { reply: async () => promise, send: resolve };
}

describe('draftMachine', () => {
    beforeEach(() => {
        draftMachine.init(ALBUM_PATH);
    });

    describe('init', () => {
        it.each([ALBUM_PATH, MEDIA_PATH, '/2001/', '/'])('starts a draft on %s', (path) => {
            draftMachine.init(path);

            expect(draftMachine.draft.path).toBe(path);
        });

        it('starts with no edits and nothing to save', () => {
            draftMachine.init(ALBUM_PATH);

            expect(draftMachine.draft.content).toStrictEqual({});
            expect(draftMachine.status).toBe(DraftStatus.NO_CHANGES);
        });

        // Only one draft exists at a time, so opening an editor has to leave
        // nothing behind from the last one
        it('discards the edits of the draft it replaces', () => {
            draftMachine.setTitle('Edited');

            draftMachine.init(MEDIA_PATH);

            expect(draftMachine.draft.content).toStrictEqual({});
            expect(draftMachine.status).toBe(DraftStatus.NO_CHANGES);
        });

        it.each(['/2001/12-31', '/2001', 'nonsense', '/2001/13-01/'])('refuses to start on %s', (path) => {
            expect(() => {
                draftMachine.init(path);
            }).toThrow(`Invalid path [${path}]`);
        });
    });

    describe('editing', () => {
        it.each([
            {
                field: 'title',
                edit: () => {
                    draftMachine.setTitle('A Title');
                },
                expected: 'A Title',
            },
            {
                field: 'description',
                edit: () => {
                    draftMachine.setDescription('A Description');
                },
                expected: 'A Description',
            },
            {
                field: 'summary',
                edit: () => {
                    draftMachine.setSummary('A Summary');
                },
                expected: 'A Summary',
            },
            {
                field: 'published',
                edit: () => {
                    draftMachine.setPublished(true);
                },
                expected: true,
            },
            // Stored rather than treated as "no value", which is the difference
            // between unpublishing an album and silently leaving it published
            {
                field: 'published',
                edit: () => {
                    draftMachine.setPublished(false);
                },
                expected: false,
            },
        ])('setting $field records $expected and marks the draft unsaved', ({ field, edit, expected }) => {
            edit();

            expect(draftMachine.draft.content).toStrictEqual({ [field]: expected });
            expect(draftMachine.status).toBe(DraftStatus.UNSAVED_CHANGES);
        });

        it('accumulates edits across separate calls', () => {
            draftMachine.setTitle('A Title');
            draftMachine.setDescription('A Description');
            draftMachine.setPublished(false);

            expect(draftMachine.draft.content).toStrictEqual({
                title: 'A Title',
                description: 'A Description',
                published: false,
            });
        });

        it('leaves an earlier edit alone when a later one overwrites a different field', () => {
            draftMachine.setTitle('A Title');

            draftMachine.setDescription('A Description');

            expect(draftMachine.draft.content?.title).toBe('A Title');
        });

        it('keeps editing the path the draft was started on', () => {
            draftMachine.setTitle('A Title');

            expect(draftMachine.draft.path).toBe(ALBUM_PATH);
        });

        // The store hands its draft out to editor components, which hold onto
        // it. Each edit has to produce a new draft rather than mutate the one
        // already handed over, or a component comparing against what it was
        // given sees no change.
        it('does not mutate a draft it has already handed out', () => {
            const handedOut = draftMachine.draft;

            draftMachine.setTitle('A Title');

            expect(handedOut.content?.title).toBeUndefined();
            expect(handedOut.status).toBe(DraftStatus.NO_CHANGES);
            expect(draftMachine.draft).not.toBe(handedOut);
        });
    });

    describe('cancel', () => {
        it('throws the edits away and has nothing left to save', () => {
            draftMachine.setTitle('A Title');

            draftMachine.cancel();

            expect(draftMachine.draft.content).toStrictEqual({});
            expect(draftMachine.status).toBe(DraftStatus.NO_CHANGES);
        });

        // Cancelling resets to the module's initial state, placeholder path and
        // all, so it forgets what was being edited rather than returning that
        // draft to untouched. Nothing breaks today because cancelling leaves
        // edit mode, and re-entering it re-inits on the current URL -- but an
        // edit made between the two would be saved against /1800. Asserted as
        // the behaviour that is, not the behaviour that was intended.
        it('forgets the path it was editing', () => {
            draftMachine.cancel();

            expect(draftMachine.draft.path).not.toBe(ALBUM_PATH);
        });
    });

    describe('okToNavigate', () => {
        it('lets the user leave a draft they have not touched', () => {
            expect(draftMachine.okToNavigate).toBe(true);
        });

        it('holds the user on a draft with unsaved edits', () => {
            draftMachine.setTitle('A Title');

            expect(draftMachine.okToNavigate).toBe(false);
        });

        it('lets the user leave once the edits are cancelled', () => {
            draftMachine.setTitle('A Title');

            draftMachine.cancel();

            expect(draftMachine.okToNavigate).toBe(true);
        });
    });

    // AlbumState's map signals its readers only when an entry is replaced by a
    // different object, so a save has to leave the entry it found untouched and
    // put a new one in its place.
    describe('save', () => {
        beforeEach(async () => {
            await clearDisk();
            resetAlbumState();
        });

        it("replaces the album's entry with one carrying an album's edit", async () => {
            const before = seedLoadedAlbum(album());
            const server = fakeServer();
            server.patch(ALBUM_ROUTE, jsonResponse({}));
            draftMachine.init(ALBUM_PATH);
            draftMachine.setDescription('New album description');

            draftMachine.save();

            await vi.waitFor(() => {
                expect(draftMachine.status).toBe(DraftStatus.SAVED);
            });
            const after = albumState.albums.get(ALBUM_PATH);

            expect(after).not.toBe(before);
            expect(after?.album?.description).toBe('New album description');
            expect(before.album.description).toBe('Old album description');

            await vi.waitFor(async () => {
                expect((await getFromDisk<AlbumGalleryItem>(ALBUM_PATH))?.description).toBe('New album description');
            });
        });

        it("replaces the album's entry with one carrying a media item's edit", async () => {
            const before = seedLoadedAlbum(album());
            const server = fakeServer();
            server.patch(MEDIA_ROUTE, jsonResponse({}));
            draftMachine.init(MEDIA_PATH);
            draftMachine.setDescription('New image description');

            draftMachine.save();

            await vi.waitFor(() => {
                expect(draftMachine.status).toBe(DraftStatus.SAVED);
            });
            const after = albumState.albums.get(ALBUM_PATH);

            expect(after).not.toBe(before);
            expect(getMedia(after?.album, MEDIA_PATH)?.description).toBe('New image description');
            expect(getMedia(before.album, MEDIA_PATH)?.description).toBe('Old image description');

            await vi.waitFor(async () => {
                const onDisk = await getFromDisk<AlbumGalleryItem>(ALBUM_PATH);

                expect(onDisk?.children?.find((child) => child.path === MEDIA_PATH)?.description).toBe(
                    'New image description',
                );
            });
        });

        it('sends the edit to the server, and holds the user on the page until it answers', async () => {
            seedLoadedAlbum(album());
            const server = fakeServer();
            const held = heldReply();
            server.patch(ALBUM_ROUTE, held.reply);
            draftMachine.init(ALBUM_PATH);
            draftMachine.setSummary('A Summary');
            draftMachine.setPublished(true);

            draftMachine.save();

            await vi.waitFor(() => {
                expect(server.calls).toHaveLength(1);
            });

            expect(server.calls[0]).toStrictEqual({
                method: 'PATCH',
                pathname: ALBUM_ROUTE,
                body: { summary: 'A Summary', published: true },
            });
            expect(draftMachine.status).toBe(DraftStatus.SAVING);
            expect(draftMachine.okToNavigate).toBe(false);

            held.send(jsonResponse({}));

            await vi.waitFor(() => {
                expect(draftMachine.status).toBe(DraftStatus.SAVED);
            });

            expect(draftMachine.okToNavigate).toBe(true);
        });

        it.each([
            { failure: 'the server refuses', reply: (): Response => jsonResponse({ errorMessage: 'No' }, 400) },
            { failure: 'the server fails', reply: (): Response => serverError() },
            {
                failure: 'the network is down',
                reply: (): Response => {
                    throw new TypeError('Failed to fetch');
                },
            },
        ])('keeps the edit and leaves the album alone when $failure', async ({ reply }) => {
            const before = seedLoadedAlbum(album());
            const server = fakeServer();
            server.patch(ALBUM_ROUTE, reply);
            draftMachine.init(ALBUM_PATH);
            draftMachine.setDescription('New album description');

            draftMachine.save();

            await vi.waitFor(() => {
                expect(draftMachine.status).toBe(DraftStatus.ERRORED);
            });

            expect(draftMachine.draft.content).toStrictEqual({ description: 'New album description' });
            expect(albumState.albums.get(ALBUM_PATH)).toBe(before);
            expect(before.album.description).toBe('Old album description');
        });

        // The server has the edit, so there is nothing for the user to retry;
        // the copy in memory is simply not there to correct
        it('reports the edit saved when the album has left memory', async () => {
            const server = fakeServer();
            server.patch(ALBUM_ROUTE, jsonResponse({}));
            draftMachine.init(ALBUM_PATH);
            draftMachine.setDescription('New album description');

            draftMachine.save();

            await vi.waitFor(() => {
                expect(draftMachine.status).toBe(DraftStatus.SAVED);
            });
        });

        // Only the edits made before Save went to the server, so one made
        // while it was answering is still unsaved
        it('holds the user on the page when they edited while it was saving', async () => {
            seedLoadedAlbum(album());
            const server = fakeServer();
            const held = heldReply();
            server.patch(ALBUM_ROUTE, held.reply);
            draftMachine.init(ALBUM_PATH);
            draftMachine.setSummary('A Summary');
            draftMachine.save();
            await vi.waitFor(() => {
                expect(server.calls).toHaveLength(1);
            });

            draftMachine.setDescription('A Description');
            held.send(jsonResponse({}));

            await vi.waitFor(() => {
                expect(albumState.albums.get(ALBUM_PATH)?.album?.summary).toBe('A Summary');
            });

            expect(draftMachine.status).toBe(DraftStatus.UNSAVED_CHANGES);
            expect(draftMachine.okToNavigate).toBe(false);
            expect(albumState.albums.get(ALBUM_PATH)?.album?.description).toBe('Old album description');
        });

        describe('after saving', () => {
            beforeEach(() => {
                vi.useFakeTimers({ toFake: ['setTimeout'] });
            });

            afterEach(() => {
                vi.useRealTimers();
            });

            async function saveAnEdit(): Promise<void> {
                seedLoadedAlbum(album());
                fakeServer().patch(ALBUM_ROUTE, jsonResponse({}));
                draftMachine.init(ALBUM_PATH);
                draftMachine.setSummary('A Summary');
                draftMachine.save();
                // vi.waitFor would move the faked clock forward as it polls
                for (let turn = 0; draftMachine.status !== DraftStatus.SAVED; turn++) {
                    if (turn === 100) throw new Error(`Draft never saved: ${String(draftMachine.status)}`);
                    await new Promise((resolve) => {
                        setImmediate(resolve);
                    });
                }
            }

            it('shows the edit saved for four seconds, then has nothing to save', async () => {
                await saveAnEdit();

                vi.advanceTimersByTime(3999);

                expect(draftMachine.status).toBe(DraftStatus.SAVED);

                vi.advanceTimersByTime(1);

                expect(draftMachine.status).toBe(DraftStatus.NO_CHANGES);
            });

            it('leaves a newer edit unsaved when the four seconds are up', async () => {
                await saveAnEdit();
                draftMachine.setDescription('A Description');

                vi.advanceTimersByTime(4000);

                expect(draftMachine.status).toBe(DraftStatus.UNSAVED_CHANGES);
            });
        });
    });
});
