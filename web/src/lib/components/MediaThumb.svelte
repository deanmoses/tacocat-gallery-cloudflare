<script lang="ts">
    import type { MediaChild } from 'tacocat-gallery-shared';
    import { mediaTitle } from '$lib/album';
    import { mediaHref, ownThumbnail, thumbnailUrl } from '$lib/urls';

    let { media }: { media: MediaChild } = $props();
    const caption = $derived(mediaTitle(media));
    const url = $derived(thumbnailUrl(ownThumbnail(media)));
</script>

<a href={mediaHref(media.path)}>
    <figure>
        {#if url !== null}
            <img alt={caption} height="200" loading="lazy" src={url} width="200" />
        {/if}
        <figcaption>
            {caption}
            {#if media.mediaType === 'video'}
                (video)
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
