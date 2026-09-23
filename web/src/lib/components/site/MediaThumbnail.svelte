<!--
  @component

  A thumbnail of a media item (image or video)
-->
<script lang="ts">
    import type { MediaActivity } from '$lib/models/album';
    import type { MediaType, ThumbnailUrlInfo } from '$lib/models/GalleryItemInterfaces';
    import type { Snippet } from 'svelte';
    import Thumbnail from './Thumbnail.svelte';

    interface Props {
        mediaType: MediaType;
        href?: string | undefined;
        thumbnailUrlInfo?: ThumbnailUrlInfo | undefined;
        title?: string | undefined;
        summary?: string | undefined;
        activity?: MediaActivity | undefined;
        selectionControls?: Snippet | undefined;
    }
    let { mediaType, href, thumbnailUrlInfo, title, summary, activity, selectionControls }: Props = $props();
    let isVideo: boolean = $derived(mediaType === 'video');
</script>

<Thumbnail
    cropping={activity?.cropping}
    deleting={activity?.deleting}
    {href}
    {isVideo}
    renaming={activity?.renaming}
    {selectionControls}
    {summary}
    {thumbnailUrlInfo}
    {title}
/>
