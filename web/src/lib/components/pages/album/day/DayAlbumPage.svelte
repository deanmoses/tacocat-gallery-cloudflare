<!--
  @component 
  
  Page displaying a day album
-->
<script lang="ts">
    import DayAlbumPageLayout from './DayAlbumPageLayout.svelte';
    import AdminToggle from '$lib/components/site/admin/toggle/AdminToggle.svelte';
    import PrevButton from '$lib/components/site/nav/PrevButton.svelte';
    import UpButton from '$lib/components/site/nav/UpButton.svelte';
    import NextButton from '$lib/components/site/nav/NextButton.svelte';
    import MediaThumbnail from '$lib/components/site/MediaThumbnail.svelte';
    import Thumbnail from '$lib/components/site/Thumbnail.svelte';
    import type { Album } from '$lib/models/GalleryItemInterfaces';
    import { albumNav } from '$lib/utils/albumNavigation';
    import type { UploadEntry } from '$lib/models/album';
    import { sessionStore } from '$lib/stores/SessionStore.svelte';
    import { albumTiles } from '$lib/utils/albumTiles';
    import { getParentAlbum, getUploadsForAlbum, mediaActivity } from '$lib/stores/AlbumState.svelte';

    interface Props {
        album: Album;
    }
    let { album }: Props = $props();
    let neighbours = $derived(albumNav(album.path, getParentAlbum(album.path)));
    let uploads: UploadEntry[] = $derived(getUploadsForAlbum(album.path));
    let tiles = $derived(albumTiles(album, uploads));
</script>

<DayAlbumPageLayout published={album.published} title={album.title}>
    {#snippet editControls()}
        <AdminToggle />
    {/snippet}

    {#snippet nav()}
        <PrevButton href={neighbours.nextHref} title={neighbours.nextTitle} />
        <UpButton href={album.parentHref} title={album.parentTitle} />
        <NextButton href={neighbours.prevHref} title={neighbours.prevTitle} />
    {/snippet}

    {#snippet caption()}
        {#if uploads.length > 0}
            {#await import('./UploadStatus.svelte') then { default: UploadStatus }}
                <UploadStatus {uploads} />
            {/await}
        {:else}
            {@html album.description}
        {/if}
    {/snippet}

    {#snippet thumbnails()}
        {#each tiles as tile (tile.path)}
            {#if tile.kind === 'upload'}
                <!--
                  Lazy / async / dynamic load the component
                  It's a hint to the bundling system that it can be put into a separate bundle,
                  so that non-admins aren't forced to download the code.
                  An empty thumbnail holds the slot while it loads, so the tiles after it do not shift.
                -->
                {#await import('$lib/components/site/admin/UploadThumbnail.svelte')}
                    <Thumbnail title={tile.upload.file.name} />
                {:then { default: UploadThumbnail }}
                    <UploadThumbnail upload={tile.upload} />
                {/await}
            {:else if tile.kind === 'media'}
                <MediaThumbnail
                    activity={mediaActivity(tile.path)}
                    href={tile.media.href}
                    mediaType={tile.media.mediaType}
                    summary={tile.media.summary}
                    thumbnailUrlInfo={tile.media.thumbnailUrlInfo}
                    title={tile.media.title}
                />
            {/if}
        {:else}
            {#if !album.published}
                <p>Drop images and videos or a 📁</p>
            {/if}
        {/each}
    {/snippet}
</DayAlbumPageLayout>

{#if sessionStore.isAdmin}
    <!--
        Lazy / async / dynamic load the component
        It's a hint to the bundling system that it can be put into a separate bundle,
        so that non-admins aren't forced to download the code.
    -->
    {#await import('./DayAlbumFullScreenDropZone.svelte') then { default: DayAlbumFullScreenDropZone }}
        <DayAlbumFullScreenDropZone albumPath={album.path} />
    {/await}
{/if}
