<script lang="ts">
    import { type Album, parentAlbumPath } from 'tacocat-gallery-shared';
    import { type AlbumNav, albumNav, albumTitle } from '$lib/album';
    import { albumHref } from '$lib/urls';

    let { album, parent }: { album: Album; parent: Promise<Album | null> } = $props();
    const up = $derived(parentAlbumPath(album.path));
    const nav = $derived(navIn(album.path, parent));

    async function navIn(path: string, pending: Promise<Album | null>): Promise<AlbumNav> {
        return albumNav(path, await pending);
    }
</script>

<nav aria-label="Nearby albums">
    {#await nav then { prev }}
        {#if prev !== null}
            <a href={albumHref(prev.path)} rel="prev">Previous: {albumTitle(prev)}</a>
        {/if}
    {/await}
    {#if up !== null}
        <a href={albumHref(up)} rel="up">Up: {albumTitle({ path: up, title: null })}</a>
    {/if}
    {#await nav then { next }}
        {#if next !== null}
            <a href={albumHref(next.path)} rel="next">Next: {albumTitle(next)}</a>
        {/if}
    {/await}
</nav>

<style>
    nav {
        display: flex;
        gap: 1rem;
    }
</style>
