<!--
  @component

  Renders the appropriate media page hero contents for a media item (the image or video player)
-->
<script lang="ts">
    import BigImage from '../image/BigImage.svelte';
    import VideoPlayer from '../video/VideoPlayer.svelte';
    import type { Media } from '$lib/models/GalleryItemInterfaces';

    interface Props {
        media: Media;
    }
    let { media }: Props = $props();
</script>

{#if media.mediaType === 'video'}
    <VideoPlayer video={media} />
{:else}
    <BigImage image={media} />
{/if}
