<script lang="ts">
    import { type Album, parentAlbumPath } from 'tacocat-gallery-shared';
    import { albumTitle } from '$lib/album';
    import { albumHref } from '$lib/urls';

    let { album }: { album: Album } = $props();
    const parent = $derived(parentAlbumPath(album.path));
</script>

<nav aria-label="Nearby albums">
    {#if album.prev !== null}
        <a href={albumHref(album.prev.path)} rel="prev">Previous: {albumTitle(album.prev)}</a>
    {/if}
    {#if parent !== null}
        <a href={albumHref(parent)} rel="up">Up: {albumTitle({ path: parent, title: null })}</a>
    {/if}
    {#if album.next !== null}
        <a href={albumHref(album.next.path)} rel="next">Next: {albumTitle(album.next)}</a>
    {/if}
</nav>

<style>
    nav {
        display: flex;
        gap: 1rem;
    }
</style>
