<script lang="ts">
    import type { AlbumChild } from 'tacocat-gallery-shared';
    import { albumTitle } from '$lib/album';
    import { albumHref, thumbnailUrl } from '$lib/urls';

    let { album }: { album: AlbumChild } = $props();
    const caption = $derived(albumTitle(album));
    const url = $derived(album.thumbnail === null ? null : thumbnailUrl(album.thumbnail));
</script>

<a href={albumHref(album.path)}>
    <figure>
        {#if url !== null}
            <img alt="" height="200" loading="lazy" src={url} width="200" />
        {/if}
        <figcaption>
            {caption}
            {#if !album.published}
                <em>unpublished</em>
            {/if}
        </figcaption>
    </figure>
</a>

<style>
    a {
        color: inherit;
        text-decoration: none;
    }

    figure {
        margin: 0;
        width: 200px;
    }

    img {
        display: block;
        object-fit: cover;
    }
</style>
