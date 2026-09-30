import type { PageLoad } from './$types';
import { searchStore } from '$lib/stores/SearchStore.svelte';
import type { SearchQuery } from '$lib/models/search';
import { sameSitePath } from '$lib/utils/returnPath';

export const load = (({ params, url }): { returnPath: string; query: SearchQuery } => {
    const query: SearchQuery = {
        terms: params.terms,
        oldestYear: toInt(url.searchParams.get('oldest')),
        newestYear: toInt(url.searchParams.get('newest')),
        oldestFirst: toBool(url.searchParams.get('oldestFirst')),
    };
    searchStore.search(query);
    return {
        returnPath: sameSitePath(url.searchParams.get('returnPath'), url.origin),
        query,
    };
}) satisfies PageLoad;

function toInt(value: string | null): number | undefined {
    return value !== null && value !== '' ? Math.trunc(Number(value)) : undefined;
}

function toBool(value: string | null): boolean {
    return value !== null && (value.toLowerCase() === 'true' || value === '1');
}
