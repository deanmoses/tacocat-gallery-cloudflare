<script lang="ts">
    import type { PageProps } from './$types';
    import { on } from 'svelte/events';
    import { preloadCode } from '$app/navigation';
    import DayAlbumRouting from '$lib/components/pages/album/day/DayAlbumRouting.svelte';
    import DayAlbumPage from '$lib/components/pages/album/day/DayAlbumPage.svelte';
    import { albumState } from '$lib/stores/AlbumState.svelte';

    let { data }: PageProps = $props();
    let albumPath = $derived(data.albumPath);
    let album = $derived(albumState.albums.get(albumPath)?.album);
    let firstMedia = $derived(album?.media[0]);

    // Whether the page's load event has fired. On a direct arrival that usually comes after the thumbnails, since the
    // album JSON arrives with the page's headers and the app has put them in the page by then; a page reached by an
    // in-app navigation loaded long ago, and what is fetched ahead of a click starts beside them.
    let pageLoaded = $state(false);
    $effect(() => {
        function markLoaded(): void {
            pageLoaded = true;
        }
        if (document.readyState === 'complete') markLoaded();
        return on(globalThis, 'load', markLoaded, { once: true });
    });

    // The media page's code, which the click would otherwise fetch; a mouse's hover would start it a little sooner, a
    // tap barely.
    $effect(() => {
        if (pageLoaded && firstMedia !== undefined) void preloadCode(firstMedia.href);
    });
</script>

<svelte:head>
    <!-- A reader's first click is usually the first thumbnail, and a photo the browser already holds opens in a third
         of the time. The low priority is what keeps it behind any thumbnail still loading, in the browsers that honour
         it; the iOS 15.6 floor ignores fetchpriority and fetches the photo as it would a thumbnail. -->
    {#if pageLoaded && firstMedia !== undefined}
        <link as="image" fetchpriority="low" href={firstMedia.detailUrl} rel="preload" />
    {/if}
</svelte:head>

<DayAlbumRouting {albumPath}>
    {#snippet loaded()}
        {#if album}
            {#if albumState.albumReorders.has(albumPath)}
                {#await import('$lib/components/pages/album/day/DayAlbumReorderPage.svelte') then { default: DayAlbumReorderPage }}
                    <DayAlbumReorderPage {album} />
                {/await}
            {:else if albumState.editMode}
                {#await import('$lib/components/pages/album/day/DayAlbumEditPage.svelte') then { default: DayAlbumEditPage }}
                    <DayAlbumEditPage {album} />
                {/await}
            {:else}
                <DayAlbumPage {album} />
            {/if}
        {/if}
    {/snippet}
</DayAlbumRouting>
