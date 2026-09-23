<!--
  @component

  A thumbnail of an album
-->
<script lang="ts">
    import { CreateStatus, DeleteStatus, RenameStatus } from '$lib/models/album';
    import { albumState } from '$lib/stores/AlbumState.svelte';
    import type { ThumbnailUrlInfo } from '$lib/models/GalleryItemInterfaces';
    import type { Snippet } from 'svelte';
    import Thumbnail from './Thumbnail.svelte';

    interface Props {
        path: string;
        href?: string | undefined;
        thumbnailUrlInfo?: ThumbnailUrlInfo | undefined;
        title?: string | undefined;
        summary?: string | undefined;
        published?: boolean | undefined;
        selectionControls?: Snippet | undefined;
    }
    let { path, href, thumbnailUrlInfo, title, summary, published, selectionControls }: Props = $props();
    let creating: boolean = $derived(CreateStatus.IN_PROGRESS === albumState.albumCreates.get(path)?.status);
    let deleting: boolean = $derived(DeleteStatus.IN_PROGRESS === albumState.albumDeletes.get(path)?.status);
    let renaming: boolean = $derived(RenameStatus.IN_PROGRESS === albumState.albumRenames.get(path)?.status);
</script>

<Thumbnail
    {creating}
    {deleting}
    {href}
    {published}
    {renaming}
    {selectionControls}
    {summary}
    {thumbnailUrlInfo}
    {title}
/>
