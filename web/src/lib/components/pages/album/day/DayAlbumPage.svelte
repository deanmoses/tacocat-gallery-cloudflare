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
    import type { Album } from '$lib/models/GalleryItemInterfaces';
    import { albumNav } from '$lib/utils/albumNavigation';
    import type { UploadEntry } from '$lib/models/album';
    import { sessionStore } from '$lib/stores/SessionStore.svelte';
    import { albumState, getParentAlbum, mediaActivity } from '$lib/stores/AlbumState.svelte';

    interface Props {
        album: Album;
    }
    let { album }: Props = $props();
    let neighbours = $derived(albumNav(album.path, getParentAlbum(album.path)));
    let uploads: UploadEntry[] = $derived(
        albumState.uploads.filter((upload) => upload.mediaPath.startsWith(album.path)),
    );
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
        {#if album.media.length > 0}
            {#each album.media as media (media.path)}
                <MediaThumbnail
                    activity={mediaActivity(media.path)}
                    href={media.href}
                    mediaType={media.mediaType}
                    summary={media.summary}
                    thumbnailUrlInfo={media.thumbnailUrlInfo}
                    title={media.title}
                />
            {/each}
        {:else if !album.published && uploads.length === 0}
            <p>Drop images and videos or a 📁</p>
        {/if}
        {#if uploads.length > 0}
            <!-- 
                  Lazy / async / dynamic load the component
                  It's a hint to the bundling system that it can be put into a separate bundle, 
                  so that non-admins aren't forced to download the code.
              -->
            {#await import('$lib/components/site/admin/UploadThumbnail.svelte') then { default: UploadThumbnail }}
                {#each uploads as upload (upload.uploadPath)}
                    <UploadThumbnail {upload} />
                {/each}
            {/await}
        {/if}
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
