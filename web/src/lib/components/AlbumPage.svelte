<script lang="ts">
    import type { Album } from 'tacocat-gallery-shared';
    import { albumTitle } from '$lib/album';
    import { albumHref } from '$lib/urls';
    import AlbumNav from './AlbumNav.svelte';
    import MediaThumb from './MediaThumb.svelte';

    let { album }: { album: Album } = $props();
    const title = $derived(albumTitle(album));
</script>

<svelte:head>
    <title>{title}</title>
</svelte:head>

<article>
    <header>
        <h1>{title}</h1>
        {#if album.description !== null}
            <p>{album.description}</p>
        {/if}
        <AlbumNav {album} />
    </header>
    <ul>
        {#each album.children as child (child.path)}
            <li>
                {#if child.itemType === 'album'}
                    <a href={albumHref(child.path)}>{albumTitle(child)}</a>
                    {#if !child.published}
                        <em>unpublished</em>
                    {/if}
                {:else}
                    <MediaThumb media={child} />
                {/if}
            </li>
        {/each}
    </ul>
</article>

<style>
    article {
        font-family: system-ui, sans-serif;
        margin: 0 auto;
        max-width: 64rem;
        padding: 1rem;
    }

    ul {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        list-style: none;
        padding: 0;
    }
</style>
