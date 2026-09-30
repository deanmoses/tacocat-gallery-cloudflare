import { describe, expect, it, vi } from 'vitest';
import { searchStore } from './SearchStore.svelte';
import { SearchLoadStatus, type SearchQuery } from '$lib/models/search';
import { fakeServer, jsonResponse, serverError } from '$lib/test-support/http';
import { albumRecord, imageRecord, mediaPath, videoRecord } from '$lib/test-support/records';
import { albumTitle } from '$lib/utils/date-utils';
import type { GalleryRecord } from '$lib/models/impl/server';

/**
 * The API is answered by a fake server; nothing here reaches the network. The store keeps a search under the query
 * object itself, so each test's query is a search of its own, whatever the tests before it searched for.
 */
const SEARCH = '/api/search/felix';

function photo(name: string): GalleryRecord {
    return imageRecord({ path: mediaPath(name), itemName: name });
}

/** The server's reply to a search: a page of the matches, and how many there are in all. */
function found(items: GalleryRecord[], total = items.length): Response {
    return jsonResponse({ total, items });
}

async function reaches(query: SearchQuery, status: SearchLoadStatus): Promise<void> {
    await vi.waitFor(() => {
        expect(searchStore.searches.get(query)?.status).toBe(status);
    });
}

function pathsOf(query: SearchQuery): string[] | undefined {
    return searchStore.searches.get(query)?.results?.items?.map((item) => item.path);
}

describe('searchStore', () => {
    describe('search', () => {
        it('is loading until the server answers, then holds the matches and how many there are in all', async () => {
            const server = fakeServer();
            server.get(SEARCH, found([photo('a'), photo('b')], 40));
            const query = { terms: 'felix' };

            searchStore.search(query);

            expect(searchStore.searches.get(query)?.status).toBe(SearchLoadStatus.LOADING);

            await reaches(query, SearchLoadStatus.LOADED);

            expect(pathsOf(query)).toStrictEqual([mediaPath('a'), mediaPath('b')]);
            expect(searchStore.searches.get(query)?.results?.total).toBe(40);
        });

        it('asks for the first thirty matches, within the years and in the order the query gives', async () => {
            const server = fakeServer();
            server.get(SEARCH, found([]));
            const query = { terms: 'felix', oldestYear: 2001, newestYear: 2005, oldestFirst: true };

            searchStore.search(query);
            await reaches(query, SearchLoadStatus.LOADED);

            expect(server.rawCalls.map((call) => call.url.search)).toStrictEqual([
                '?oldest=2001&newest=2005&oldestFirst=true&pageSize=30',
            ]);
        });

        it('asks the server once for a search it is already loading or has', async () => {
            const server = fakeServer();
            server.get(SEARCH, found([photo('a')]));
            const query = { terms: 'felix' };

            searchStore.search(query);
            searchStore.search(query);
            await reaches(query, SearchLoadStatus.LOADED);
            searchStore.search(query);

            expect(searchStore.searches.get(query)?.status).toBe(SearchLoadStatus.LOADED);
            expect(server.calls).toHaveLength(1);
        });

        it('captions a photo or a video with the day it is from, and an album with its own summary', async () => {
            const server = fakeServer();
            server.get(
                SEARCH,
                found([
                    imageRecord({ path: mediaPath('felix'), itemName: 'felix', title: 'Felix' }),
                    videoRecord({ path: mediaPath('first_steps'), itemName: 'first_steps' }),
                    albumRecord({
                        path: '/2001/06-15/',
                        parentPath: '/2001/',
                        itemName: '06-15',
                        summary: 'Felix turns one',
                    }),
                ]),
            );
            const query = { terms: 'felix' };

            searchStore.search(query);
            await reaches(query, SearchLoadStatus.LOADED);

            const shown = searchStore.searches.get(query)?.results?.items?.map((item) => ({
                href: item.href,
                mediaType: item.mediaType,
                title: item.title,
                summary: item.summary,
            }));

            // The runtime's locale decides how a date reads; which day it names is the assertion.
            expect(shown).toStrictEqual([
                {
                    href: mediaPath('felix'),
                    mediaType: 'image',
                    title: 'Felix',
                    summary: albumTitle('/2001/12-31/'),
                },
                {
                    href: mediaPath('first_steps'),
                    mediaType: 'video',
                    title: 'First Steps',
                    summary: albumTitle('/2001/12-31/'),
                },
                {
                    href: '/2001/06-15',
                    mediaType: undefined,
                    title: albumTitle('/2001/06-15/'),
                    summary: 'Felix turns one',
                },
            ]);
        });

        it('keeps the message the server refused a search with, for the page to show', async () => {
            const server = fakeServer();
            const message = 'A search needs a word to look for, not only words to leave out';
            server.get('/api/search/-felix', jsonResponse({ errorMessage: message }, 400));
            const query = { terms: '-felix' };

            searchStore.search(query);
            await reaches(query, SearchLoadStatus.ERROR_LOADING);

            expect(searchStore.searches.get(query)?.error).toBe(message);
        });

        it('keeps no message from a failure that carried none', async () => {
            const server = fakeServer();
            server.get(SEARCH, serverError());
            const query = { terms: 'felix' };

            searchStore.search(query);
            await reaches(query, SearchLoadStatus.ERROR_LOADING);

            expect(searchStore.searches.get(query)?.error).toBeUndefined();
        });

        it.each([
            { name: 'no list of items', reply: { total: 1 } },
            { name: 'no total', reply: { items: [] } },
            { name: 'an item that does not say what it is', reply: { total: 1, items: [{ path: mediaPath('a') }] } },
        ])('fails on a reply with $name', async ({ reply }) => {
            const server = fakeServer();
            server.get(SEARCH, jsonResponse(reply));
            const query = { terms: 'felix' };

            searchStore.search(query);
            await reaches(query, SearchLoadStatus.ERROR_LOADING);

            expect(searchStore.searches.get(query)?.results).toBeUndefined();
        });

        it('fails when the server cannot be reached', async () => {
            const server = fakeServer();
            server.get(SEARCH, () => {
                throw new TypeError('Failed to fetch');
            });
            const query = { terms: 'felix' };

            searchStore.search(query);
            await reaches(query, SearchLoadStatus.ERROR_LOADING);

            expect(searchStore.searches.get(query)?.results).toBeUndefined();
        });
    });

    describe('getMore', () => {
        /** A search whose first page of two has landed, and the server's answer to the request for more. */
        async function firstPageOf(total: number, more: Response | (() => Response)): Promise<SearchQuery> {
            const server = fakeServer();
            server.get(SEARCH, found([photo('a'), photo('b')], total), more);
            const query = { terms: 'felix', oldestYear: 2001 };
            searchStore.search(query);
            await reaches(query, SearchLoadStatus.LOADED);
            return query;
        }

        it('asks from where the last page ended, and adds what comes back after what it has', async () => {
            const query = await firstPageOf(3, found([photo('c')], 3));
            const fetched = vi.mocked(fetch);

            searchStore.getMore(query, 2);

            expect(searchStore.searches.get(query)?.status).toBe(SearchLoadStatus.LOADING_MORE_RESULTS);
            expect(pathsOf(query)).toStrictEqual([mediaPath('a'), mediaPath('b')]);

            await reaches(query, SearchLoadStatus.LOADED);

            expect(fetched).toHaveBeenLastCalledWith('/api/search/felix?oldest=2001&startAt=2&pageSize=30');
            expect(pathsOf(query)).toStrictEqual([mediaPath('a'), mediaPath('b'), mediaPath('c')]);
            expect(searchStore.searches.get(query)?.results?.nextStartAt).toBe(3);
        });

        /**
         * An item added to the gallery between two requests pushes every later match along by one, so the second page
         * begins with the first page's last item.
         */
        it('drops a match it already has, and still counts it toward where the next page starts', async () => {
            const query = await firstPageOf(5, found([photo('b'), photo('c')], 5));

            searchStore.getMore(query, 2);
            await vi.waitFor(() => {
                expect(searchStore.searches.get(query)?.results?.nextStartAt).toBe(4);
            });

            expect(pathsOf(query)).toStrictEqual([mediaPath('a'), mediaPath('b'), mediaPath('c')]);
        });

        // A total the pages never reach would otherwise have the page ask for the same empty page without end.
        it('takes an empty page as the end, whatever the total says', async () => {
            const query = await firstPageOf(5, found([], 5));

            searchStore.getMore(query, 2);
            await vi.waitFor(() => {
                expect(searchStore.searches.get(query)?.results?.nextStartAt).toBe(5);
            });

            expect(pathsOf(query)).toStrictEqual([mediaPath('a'), mediaPath('b')]);
        });

        it('keeps the matches it has when more cannot be had, and says so', async () => {
            const query = await firstPageOf(3, serverError());

            searchStore.getMore(query, 2);
            await reaches(query, SearchLoadStatus.ERROR_LOADING_MORE_RESULTS);

            expect(pathsOf(query)).toStrictEqual([mediaPath('a'), mediaPath('b')]);
            expect(searchStore.searches.get(query)?.results?.total).toBe(3);
        });
    });
});
