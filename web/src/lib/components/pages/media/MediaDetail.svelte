<!--
  @component

  Renders the appropriate detail page hero contents for a media item (the image or video player)
-->
<script lang="ts">
    import BigImage from '../image/BigImage.svelte';
    import VideoPlayer from '../video/VideoPlayer.svelte';
    import type { Image, Media, Video } from '$lib/models/GalleryItemInterfaces';

    interface Props {
        media: Media;
    }
    let { media }: Props = $props();

    function isVideo(item: Media): item is Video {
        return item.mediaType === 'video';
    }

    function isImage(item: Media): item is Image {
        return item.mediaType === 'image';
    }
</script>

{#if isVideo(media)}
    <VideoPlayer video={media} />
{:else if isImage(media)}
    <BigImage image={media} />
{:else}
    Unsupported media type
{/if}
