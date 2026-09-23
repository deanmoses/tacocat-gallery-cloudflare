<script lang="ts">
    import type { MediaChild } from 'tacocat-gallery-shared';
    import { thumbnailUrl } from '$lib/urls';

    let { media }: { media: MediaChild } = $props();
    const caption = $derived(media.title ?? media.itemName);
    const url = $derived(thumbnailUrl(media));
</script>

<figure>
    {#if url !== null}
        <img alt={caption} height="200" loading="lazy" src={url} width="200" />
    {/if}
    <figcaption>
        {caption}
        {#if media.itemType === 'video'}
            (video)
        {/if}
    </figcaption>
</figure>

<style>
    figure {
        margin: 0;
        width: 200px;
    }

    img {
        display: block;
        object-fit: cover;
    }
</style>
