<!--
  @component

  A thumbnail of a media item (image or video)
-->
<script lang="ts">
    import { CropStatus, DeleteStatus, RenameStatus } from '$lib/models/album';
    import { albumState } from '$lib/stores/AlbumState.svelte';
    import type { MediaType, ThumbnailUrlInfo } from '$lib/models/GalleryItemInterfaces';
    import type { Snippet } from 'svelte';
    import Thumbnail from './Thumbnail.svelte';

    interface Props {
        path: string;
        mediaType: MediaType;
        href?: string | undefined;
        thumbnailUrlInfo?: ThumbnailUrlInfo | undefined;
        title?: string | undefined;
        summary?: string | undefined;
        selectionControls?: Snippet | undefined;
    }
    let { path, mediaType, href, thumbnailUrlInfo, title, summary, selectionControls }: Props = $props();
    let deleting: boolean = $derived(DeleteStatus.IN_PROGRESS === albumState.mediaDeletes.get(path)?.status);
    let renaming: boolean = $derived(RenameStatus.IN_PROGRESS === albumState.mediaRenames.get(path)?.status);
    let cropping: boolean = $derived(CropStatus.IN_PROGRESS === albumState.crops.get(path)?.status);
    let isVideo: boolean = $derived(mediaType === 'video');
</script>

<Thumbnail {cropping} {deleting} {href} {isVideo} {renaming} {selectionControls} {summary} {thumbnailUrlInfo} {title} />
