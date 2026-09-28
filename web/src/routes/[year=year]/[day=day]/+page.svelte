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
    let firstMediaHref = $derived(album?.media[0]?.href);

    // Opening a photo otherwise waits on the photo page's code, fetched on the click; a mouse's hover starts it a little
    // sooner, a tap barely. Fetched once the album page has loaded, behind its thumbnails rather than beside them.
    $effect(() => {
        const href = firstMediaHref;
        function preload(): void {
            if (href !== undefined) void preloadCode(href);
        }
        if (document.readyState === 'complete') preload();
        return on(globalThis, 'load', preload, { once: true });
    });
</script>

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
