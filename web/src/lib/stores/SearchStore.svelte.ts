import type { Search, SearchQuery, SearchResults } from '$lib/models/search';
import { SearchLoadStatus } from '$lib/models/search';
import toAlbum from '$lib/models/impl/AlbumCreator';
import { ImageThumbableImpl } from '$lib/models/impl/ImageThumbableImpl';
import { VideoThumbableImpl } from '$lib/models/impl/VideoThumbableImpl';
import { searchUrl } from '$lib/utils/config';
import { albumTitle } from '$lib/utils/date-utils';
import { parentPathOf } from '@tacocat-gallery/shared';
import type { GalleryRecord, ImageRecord, VideoRecord } from '$lib/models/impl/server';
import { errorMessageOf } from '@tacocat-gallery/shared';
import { isAlbumRecord, isImageRecord, isVideoRecord } from '$lib/models/impl/server';
import type { Thumbable } from '$lib/models/GalleryItemInterfaces';
import { SvelteMap } from 'svelte/reactivity';

/**
 * Store of search results. A search is kept for as long as the page is open, so going back to the results from a match
 * shows them as the reader left them, every page they scrolled through included. Unlike an album, a search is not
 * fetched again when it is shown again: that would drop the later pages and the reader's place in them. Nor is it
 * dropped when an admin changes the gallery, so it can miss the change: admins edit from albums, not from search
 * results.
 */
class SearchStore {
    /** Keyed by the URL of a search's first page, so two queries that ask the server the same thing are one search */
    readonly #searches = new SvelteMap<string, Search>();

    /** Moves on at each clear(), so an answer on its way to a search forgotten meanwhile is dropped */
    #generation = 0;

    get(query: SearchQuery): Search | undefined {
        return this.#searches.get(keyOf(query));
    }

    /**
     * Do the search, unless it is held. A failure is not kept: a search that failed is made again, and one whose next
     * page failed goes back to asking for it.
     */
    search(query: SearchQuery): void {
        switch (this.get(query)?.status) {
            case undefined:
            case SearchLoadStatus.NOT_LOADED:
            case SearchLoadStatus.ERROR_LOADING:
                this.#setLoadStatus(query, SearchLoadStatus.LOADING);
                void this.#fetchFromServer(query);
                break;
            case SearchLoadStatus.ERROR_LOADING_MORE_RESULTS:
                this.#setLoadStatus(query, SearchLoadStatus.LOADED);
                break;
            case SearchLoadStatus.LOADING:
            case SearchLoadStatus.LOADING_MORE_RESULTS:
            case SearchLoadStatus.LOADED:
                break;
        }
    }

    /**
     * Fetch more results for an existing search
     *
     * @param startAt The number result from which to start fetching
     */
    getMore(query: SearchQuery, startAt: number): void {
        console.log(`Getting more results...`, query, startAt);
        this.#setLoadStatus(query, SearchLoadStatus.LOADING_MORE_RESULTS);
        void this.#fetchFromServer(query, startAt);
    }

    /** Forgets every search, and the answers still on their way to them */
    clear(): void {
        this.#generation += 1;
        this.#searches.clear();
    }

    /**
     * Fetch search results from server
     *
     * @param startAt The number result from which to start fetching
     */
    async #fetchFromServer(query: SearchQuery, startAt = 0): Promise<void> {
        const pageSize = 30;
        const generation = this.#generation;
        try {
            const response = await fetch(searchUrl(query, startAt, pageSize));
            if (!response.ok) {
                const message = await refusal(response);
                if (generation === this.#generation) {
                    this.#handleFetchError(query, new Error(response.statusText), message);
                }
                return;
            }
            const json: unknown = await response.json();
            if (generation !== this.#generation) return;
            console.log(`Search`, query, `fetched from server`, json);
            if (!isServerSearchResults(json)) throw new Error('Expected a total and a list of items');
            const searchResults = this.#toSearchResults(json);
            console.log(`Transformed search results`, searchResults);
            // Calculate next offset based on server response size, not filtered size
            const serverItemCount = searchResults.items?.length ?? 0;
            // An empty page is the end whatever the total says: asking again would get the same empty page, forever
            searchResults.nextStartAt = serverItemCount === 0 ? searchResults.total : startAt + serverItemCount;
            if (startAt > 0) {
                const prev = this.get(query);
                if (prev?.results?.items && searchResults.items) {
                    // Filter out duplicates by path (handles edge case of data changing between requests)
                    const existingPaths = new Set(prev.results.items.map((item) => item.path));
                    const newItems = searchResults.items.filter((item) => !existingPaths.has(item.path));
                    console.log(
                        `Adding ${newItems.length} new results to ${prev.results.items.length} existing results (${searchResults.items.length - newItems.length} duplicates filtered)`,
                    );
                    searchResults.items = prev.results.items.concat(newItems);
                }
            }
            this.#setSearch(query, searchResults); // Put search results in Svelte store
        } catch (error) {
            if (generation === this.#generation) this.#handleFetchError(query, error);
        }
    }

    /** `message` is what the server said when it refused the search. */
    #handleFetchError(query: SearchQuery, error: unknown, message?: string): void {
        console.error(`Search error fetching from server:`, query, error);
        const status = this.get(query)?.status ?? SearchLoadStatus.NOT_LOADED;
        switch (status) {
            case SearchLoadStatus.LOADING:
            case SearchLoadStatus.NOT_LOADED:
                this.#setLoadStatus(query, SearchLoadStatus.ERROR_LOADING, message);
                break;
            case SearchLoadStatus.LOADING_MORE_RESULTS:
            case SearchLoadStatus.LOADED:
                this.#setLoadStatus(query, SearchLoadStatus.ERROR_LOADING_MORE_RESULTS, message);
                break;
            case SearchLoadStatus.ERROR_LOADING:
            case SearchLoadStatus.ERROR_LOADING_MORE_RESULTS:
                // already in correct state
                break;
            default:
                console.error('Unexepected load status:', status);
        }
    }

    /**
     * Store search results in Svelte store
     */
    #setSearch(query: SearchQuery, searchResults: SearchResults): void {
        const searchEntry = this.#getOrCreateWritableStore(query);
        const newState: Search = { ...searchEntry, status: SearchLoadStatus.LOADED, results: searchResults };
        this.#searches.set(keyOf(query), newState);
    }

    /**
     * Set the load status of the search
     */
    #setLoadStatus(query: SearchQuery, loadStatus: SearchLoadStatus, error?: string): void {
        const searchEntry = this.#getOrCreateWritableStore(query);
        const newState: Search = { ...searchEntry, status: loadStatus, error };
        this.#searches.set(keyOf(query), newState);
    }

    /** The search, or a stand-in for one not yet made */
    #getOrCreateWritableStore(query: SearchQuery): Search {
        return this.get(query) ?? { status: SearchLoadStatus.NOT_LOADED };
    }

    /**
     * Transform from server JSON to a search results object
     *
     * @param json JSON object coming from server
     */
    #toSearchResults(json: ServerSearchResults): SearchResults {
        const items: GalleryRecord[] = json.items;
        return {
            total: json.total,
            items: items.map((item) => this.#toThumbable(item)),
        };
    }

    #toThumbable(json: GalleryRecord): Thumbable {
        if (isAlbumRecord(json)) {
            return toAlbum(json);
        } else if (isVideoRecord(json)) {
            return this.#toVideo(json);
        } else if (isImageRecord(json)) {
            return this.#toImage(json);
        }
        throw new Error(`Unknown item type in ${JSON.stringify(json)}`);
    }

    #toImage(json: ImageRecord): ImageThumbableImpl {
        const image = new ImageThumbableImpl(json);
        image.summary = this.#dateFromPath(image.path);
        return image;
    }

    #toVideo(json: VideoRecord): VideoThumbableImpl {
        const video = new VideoThumbableImpl(json);
        video.summary = this.#dateFromPath(video.path);
        return video;
    }

    #dateFromPath(mediaPath: string): string {
        return albumTitle(parentPathOf(mediaPath));
    }
}
export const searchStore: SearchStore = new SearchStore();

function keyOf(query: SearchQuery): string {
    return searchUrl(query, 0, 0);
}

interface ServerSearchResults {
    total: number;
    items: GalleryRecord[];
}

/** What the server said when it refused the search. */
async function refusal(response: Response): Promise<string | undefined> {
    try {
        return errorMessageOf(await response.json());
    } catch {
        return undefined;
    }
}

/**
 * Checks the shape the transform reads: a count and a list of records, each saying which kind it is. What a record
 * holds beyond that is the model classes' concern.
 */
function isServerSearchResults(value: unknown): value is ServerSearchResults {
    return (
        typeof value === 'object' &&
        value !== null &&
        'total' in value &&
        typeof value.total === 'number' &&
        'items' in value &&
        Array.isArray(value.items) &&
        value.items.every(isGalleryRecordLike)
    );
}

function isGalleryRecordLike(item: unknown): boolean {
    return (
        typeof item === 'object' &&
        item !== null &&
        'itemType' in item &&
        (item.itemType === 'album' || item.itemType === 'media') &&
        'path' in item &&
        typeof item.path === 'string'
    );
}
