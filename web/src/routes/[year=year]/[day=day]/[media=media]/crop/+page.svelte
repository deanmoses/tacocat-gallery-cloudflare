<script lang="ts">
    import type { PageProps } from './$types';
    import CropPage from '$lib/components/pages/media/CropPage.svelte';
    import MediaRouting from '$lib/components/pages/media/MediaRouting.svelte';
    import { albumState } from '$lib/stores/AlbumState.svelte';
    import { getMedia } from '$lib/utils/albumNavigation';

    let { data }: PageProps = $props();
    let albumPath = $derived(data.albumPath);
    let mediaPath = $derived(data.mediaPath);
    let media = $derived(getMedia(albumState.albums.get(albumPath)?.album, mediaPath));
</script>

<MediaRouting {albumPath} {media} {mediaPath}>
    {#snippet loaded()}
        {#if media}
            <CropPage {media} />
        {/if}
    {/snippet}
</MediaRouting>
