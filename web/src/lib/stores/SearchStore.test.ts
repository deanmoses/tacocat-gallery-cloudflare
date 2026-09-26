import { describe, expect, it, vi } from 'vitest';
import { searchStore } from './SearchStore.svelte';
import { SearchLoadStatus } from '$lib/models/search';
import { fakeServer, jsonResponse, serverError } from '$lib/test-support/http';

/**
 * Covers what the store keeps of a refused search. The API is answered by a fake server; nothing here reaches the
 * network.
 */
describe('searchStore', () => {
    it('keeps the message the server refused a search with, for the page to show', async () => {
        const server = fakeServer();
        const message = 'A search needs a word to look for, not only words to leave out';
        server.get('/api/search/-felix', jsonResponse({ errorMessage: message }, 400));
        const query = { terms: '-felix' };

        searchStore.search(query);

        await vi.waitFor(() => {
            expect(searchStore.searches.get(query)?.status).toBe(SearchLoadStatus.ERROR_LOADING);
        });

        expect(searchStore.searches.get(query)?.error).toBe(message);
    });

    it('keeps no message from a failure that carried none', async () => {
        const server = fakeServer();
        server.get('/api/search/felix', serverError());
        const query = { terms: 'felix' };

        searchStore.search(query);

        await vi.waitFor(() => {
            expect(searchStore.searches.get(query)?.status).toBe(SearchLoadStatus.ERROR_LOADING);
        });

        expect(searchStore.searches.get(query)?.error).toBeUndefined();
    });
});
