<!--
  @component 
  
  Page to edit a day album
-->
<script lang="ts">
    import DayAlbumPageLayout from './DayAlbumPageLayout.svelte';
    import PrevButton from '$lib/components/site/nav/PrevButton.svelte';
    import UpButton from '$lib/components/site/nav/UpButton.svelte';
    import NextButton from '$lib/components/site/nav/NextButton.svelte';
    import MediaThumbnail from '$lib/components/site/MediaThumbnail.svelte';
    import SelectableStar from '$lib/components/site/admin/SelectableStar.svelte';
    import AlbumEditControls from '$lib/components/site/admin/edit_controls/AlbumEditControls.svelte';
    import EditableHtml from '$lib/components/site/admin/EditableHtml.svelte';
    import type { Album } from '$lib/models/GalleryItemInterfaces';
    import { albumNav } from '$lib/utils/albumNavigation';
    import DayAlbumFullScreenDropZone from './DayAlbumFullScreenDropZone.svelte';
    import type { UploadEntry } from '$lib/models/album';
    import UploadThumbnail from '$lib/components/site/admin/UploadThumbnail.svelte';
    import { draftMachine } from '$lib/stores/admin/DraftMachine.svelte';
    import { albumThumbnailSetMachine } from '$lib/stores/admin/AlbumThumbnailSetMachine.svelte';
    import { getParentAlbum, getUploadsForAlbum, mediaActivity } from '$lib/stores/AlbumState.svelte';

    interface Props {
        album: Album;
    }
    let { album }: Props = $props();
    let neighbours = $derived(albumNav(album.path, getParentAlbum(album.path)));
    let okToNavigate = $derived(draftMachine.okToNavigate);
    let uploads: UploadEntry[] = $derived(getUploadsForAlbum(album.path));

    function albumThumbnailSelected(newThumbnailMediaPath: string): void {
        albumThumbnailSetMachine.setAlbumThumbnail(album.path, newThumbnailMediaPath);
    }
</script>

<DayAlbumPageLayout published={album.published} title={album.title}>
    {#snippet editControls()}
        <AlbumEditControls published={album.published} showSummary summary={album.summary} />
    {/snippet}

    {#snippet nav()}
        <PrevButton href={okToNavigate ? neighbours.nextHref : undefined} title={neighbours.nextTitle} />
        <UpButton href={okToNavigate ? album.parentHref : undefined} title={album.parentTitle} />
        <NextButton href={okToNavigate ? neighbours.prevHref : undefined} title={neighbours.prevTitle} />
    {/snippet}

    {#snippet caption()}
        {#if uploads.length > 0}
            {#await import('./UploadStatus.svelte') then { default: UploadStatus }}
                <UploadStatus {uploads} />
            {/await}
        {:else}
            <EditableHtml htmlContent={album.description} />
        {/if}
    {/snippet}

    {#snippet thumbnails()}
        {#if album.media.length > 0}
            {#each album.media as media (media.path)}
                {#if okToNavigate}
                    <MediaThumbnail
                        activity={mediaActivity(media.path)}
                        href={media.path}
                        mediaType={media.mediaType}
                        summary={media.summary}
                        thumbnailUrlInfo={media.thumbnailUrlInfo}
                        title={media.title}
                    >
                        {#snippet selectionControls()}
                            <SelectableStar
                                albumThumbPath={album.thumbnailPath}
                                onSelected={albumThumbnailSelected}
                                path={media.path}
                            />
                        {/snippet}
                    </MediaThumbnail>
                {:else}
                    <div title="💾 Save changes before navigating">
                        <MediaThumbnail
                            activity={mediaActivity(media.path)}
                            mediaType={media.mediaType}
                            summary={media.summary}
                            thumbnailUrlInfo={media.thumbnailUrlInfo}
                            title={media.title}
                        />
                    </div>
                {/if}
            {/each}
        {:else if !album.published && uploads.length === 0 && okToNavigate}
            <p>Drop images and videos or a 📁</p>
        {/if}
        {#if uploads.length > 0}
            {#each uploads as upload (upload.path)}
                <UploadThumbnail {upload} />
            {/each}
        {/if}
    {/snippet}
</DayAlbumPageLayout>
<DayAlbumFullScreenDropZone albumPath={album.path} allowDrop={okToNavigate} />

<style>
    div {
        cursor: not-allowed;
    }

    :global(.thumbnail:hover .not-selected) {
        animation: fade-in 1400ms;
        display: inherit;
    }

    @keyframes fade-in {
        0% {
            opacity: 0;
        }

        25% {
            opacity: 0;
        }

        100% {
            opacity: 1;
        }
    }
</style>
