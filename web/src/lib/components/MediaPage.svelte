<script lang="ts">
    import type { MediaInAlbum } from '$lib/album';
    import { albumTitle, mediaTitle } from '$lib/album';
    import { albumHref, detailImageUrl, mediaHref, videoUrl } from '$lib/urls';

    let { album, media, prev, next }: MediaInAlbum = $props();
    const title = $derived(mediaTitle(media));
    const detail = $derived(detailImageUrl(media));
    const video = $derived(media.itemType === 'video' ? videoUrl(media) : null);
</script>

<svelte:head>
    <title>{title}</title>
</svelte:head>

<article>
    <header>
        <h1>{title}</h1>
        <nav aria-label="Nearby media">
            {#if prev !== null}
                <a href={mediaHref(prev.path)} rel="prev">Previous: {mediaTitle(prev)}</a>
            {/if}
            <a href={albumHref(album.path)} rel="up">Up: {albumTitle(album)}</a>
            {#if next !== null}
                <a href={mediaHref(next.path)} rel="next">Next: {mediaTitle(next)}</a>
            {/if}
        </nav>
    </header>
    {#if video !== null}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video controls poster={detail} preload="metadata" src={video}></video>
    {:else if detail !== null}
        <img alt={title} src={detail} />
    {/if}
    {#if media.description !== null}
        <p>{media.description}</p>
    {/if}
    {#if media.tags !== null}
        <p>Tags: {media.tags}</p>
    {/if}
</article>

<style>
    article {
        font-family: system-ui, sans-serif;
        margin: 0 auto;
        max-width: 64rem;
        padding: 1rem;
    }

    nav {
        display: flex;
        gap: 1rem;
    }

    img,
    video {
        display: block;
        height: auto;
        max-width: 100%;
    }
</style>
