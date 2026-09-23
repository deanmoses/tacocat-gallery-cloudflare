<!--
  @component

  A thumbnail of an album
-->
<script lang="ts">
    import type { AlbumActivity } from '$lib/models/album';
    import type { ThumbnailUrlInfo } from '$lib/models/GalleryItemInterfaces';
    import type { Snippet } from 'svelte';
    import Thumbnail from './Thumbnail.svelte';

    interface Props {
        href?: string | undefined;
        thumbnailUrlInfo?: ThumbnailUrlInfo | undefined;
        title?: string | undefined;
        summary?: string | undefined;
        published?: boolean | undefined;
        activity?: AlbumActivity | undefined;
        selectionControls?: Snippet | undefined;
    }
    let { href, thumbnailUrlInfo, title, summary, published, activity, selectionControls }: Props = $props();
</script>

<Thumbnail
    creating={activity?.creating}
    deleting={activity?.deleting}
    {href}
    {published}
    renaming={activity?.renaming}
    {selectionControls}
    {summary}
    {thumbnailUrlInfo}
    {title}
/>
