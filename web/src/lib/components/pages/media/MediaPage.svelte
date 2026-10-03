<!--
  @component

  Page to display a media item (image or video)
-->
<script lang="ts">
    import MediaPageLayout from './layouts/MediaPageLayout.svelte';
    import PrevButton from '$lib/components/site/nav/PrevButton.svelte';
    import UpButton from '$lib/components/site/nav/UpButton.svelte';
    import NextButton from '$lib/components/site/nav/NextButton.svelte';
    import MediaDetail from './MediaDetail.svelte';
    import AdminToggle from '$lib/components/site/admin/toggle/AdminToggle.svelte';
    import type { Album, Media } from '$lib/models/GalleryItemInterfaces';
    import { sessionStore } from '$lib/stores/SessionStore.svelte';
    import { mediaNeighbours } from '$lib/utils/albumNavigation';

    interface Props {
        album: Album;
        media: Media;
    }
    let { album, media }: Props = $props();
    let mediaTitle = $derived(media.title);
    // The media on either side, which the page also preloads for smoother navigation
    let neighbours = $derived(mediaNeighbours(album, media.path));
    let nextMedia = $derived(neighbours.next);
    let prevMedia = $derived(neighbours.prev);
</script>

<svelte:head>
    {#if nextMedia}
        <link as="image" href={nextMedia.detailUrl} rel="preload" />
    {/if}
    {#if prevMedia}
        <link as="image" href={prevMedia.detailUrl} rel="preload" />
    {/if}
</svelte:head>

<MediaPageLayout title={mediaTitle}>
    {#snippet editControls()}
        <AdminToggle />
    {/snippet}

    {#snippet caption()}
        {@html media.description}
    {/snippet}

    {#snippet nav()}
        <PrevButton href={prevMedia?.href} />
        <UpButton href={album.href} title={album.title} />
        <NextButton href={nextMedia?.href} />
    {/snippet}

    {#snippet imageHtml()}
        <!-- #key ensures media changes when navigating prev/next -->
        {#key media.path}
            <MediaDetail {media} />
        {/key}
    {/snippet}
</MediaPageLayout>

{#if sessionStore.isAdmin}
    {#await import('./MediaPageFullScreenDropZone.svelte') then { default: FullScreenDropZone }}
        <FullScreenDropZone mediaPath={media.path} />
    {/await}
{/if}
