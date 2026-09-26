import type { Thumbable } from './GalleryItemInterfaces';

/**
 * Search querty to send to server
 */
export interface SearchQuery {
    terms: string;
    oldestYear?: number | undefined;
    newestYear?: number | undefined;
    oldestFirst?: boolean;
}

/**
 * An in-progress search
 */
export interface Search {
    status: SearchLoadStatus;
    results?: SearchResults;
    /** Why the server refused the search, in its words, when it said */
    error?: string | undefined;
}

/**
 * Search results
 */
export interface SearchResults {
    /** Total # of results in gallery, not this specific set of results */
    total: number;
    items?: Thumbable[];
    /** Next offset to use for pagination (based on server response, not filtered items) */
    nextStartAt?: number;
}

/**
 * Status of the initial load of the search results
 */
export const SearchLoadStatus = {
    /** The search has not been searched for  */
    NOT_LOADED: 'NOT_LOADED',
    /** Searching is underway */
    LOADING: 'LOADING',
    /** Retrieving more results is underway */
    LOADING_MORE_RESULTS: 'LOADING_MORE_RESULTS',
    /** There was an error searching */
    ERROR_LOADING: 'ERROR_LOADING',
    /** There was an error loading additional results */
    ERROR_LOADING_MORE_RESULTS: 'ERROR_LOADING_MORE_RESULTS',
    /** The search has been successfully loaded */
    LOADED: 'LOADED',
} as const;
export type SearchLoadStatus = (typeof SearchLoadStatus)[keyof typeof SearchLoadStatus];
