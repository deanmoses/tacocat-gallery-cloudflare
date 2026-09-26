<script lang="ts">
    import type { PageProps } from './$types';
    import BlankSearchPageLayout from '$lib/components/pages/search/BlankSearchPageLayout.svelte';
    import SearchLoadingPage from '$lib/components/pages/search/SearchLoadingPage.svelte';
    import SearchResultsPage from '$lib/components/pages/search/SearchResultsPage.svelte';
    import { type Search, SearchLoadStatus, type SearchResults } from '$lib/models/search';
    import { searchStore } from '$lib/stores/SearchStore.svelte';

    let { data }: PageProps = $props();
    let returnPath = $derived(data.returnPath);
    let query = $derived(data.query);
    let searchTerms = $derived(data.query.terms);
    let search: Search | undefined = $derived(searchStore.searches.get(query));
    let status: SearchLoadStatus | undefined = $derived(search?.status);
    let results: SearchResults | undefined = $derived(search?.results);
</script>

{#if SearchLoadStatus.NOT_LOADED === status}
    <SearchLoadingPage {returnPath} {searchTerms} />
{:else if SearchLoadStatus.LOADING === status}
    <SearchLoadingPage {returnPath} {searchTerms} />
{:else if SearchLoadStatus.ERROR_LOADING === status}
    <BlankSearchPageLayout {returnPath} {searchTerms}
        >{search?.error ?? 'There was an error searching'}</BlankSearchPageLayout
    >
{:else if SearchLoadStatus.LOADED === status || SearchLoadStatus.LOADING_MORE_RESULTS === status || SearchLoadStatus.ERROR_LOADING_MORE_RESULTS === status}
    <SearchResultsPage {query} {results} {returnPath} {status} />
{:else}
    <BlankSearchPageLayout {returnPath} {searchTerms}>
        Unhandled status: <div>{status}</div>
    </BlankSearchPageLayout>
{/if}
