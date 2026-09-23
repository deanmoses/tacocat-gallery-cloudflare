<!--
  @component

  Page to crop the thumbnail of a media item
-->
<script lang="ts">
    import MediaPageLayout from './layouts/MediaPageLayout.svelte';
    import CropThumbnail from './CropThumbnail.svelte';
    import type { Media } from '$lib/models/GalleryItemInterfaces';
    import CancelIcon from '$lib/components/site/icons/CancelIcon.svelte';
    import SaveIcon from '$lib/components/site/icons/SaveIcon.svelte';
    import { goto } from '$app/navigation';
    import { cropMachine } from '$lib/stores/admin/CropMachine.svelte';
    import { albumState } from '$lib/stores/AlbumState.svelte';
    import { type Crop, CropStatus } from '$lib/models/album';

    interface Props {
        media: Media;
    }

    /** What this page asks of the cropper it binds to */
    interface ThumbnailCropper {
        getCrop: () => Crop;
    }

    let { media }: Props = $props();
    let mediaTitle: string = $derived(media.title);
    let cropStatus: CropStatus | undefined = $derived(albumState.crops.get(media.path)?.status);
    let disableButtons: boolean = $derived(cropStatus === CropStatus.IN_PROGRESS);
    let cropper: ThumbnailCropper | undefined = $state();

    function onCancel(): void {
        void goto(media.path);
    }

    function onSave(): void {
        if (cropper === undefined) return;
        cropMachine.crop(media.path, cropper.getCrop());
        void goto(media.path);
    }
</script>

<MediaPageLayout title={mediaTitle}>
    {#snippet caption()}
        <button disabled={disableButtons} onclick={onCancel} type="button"><CancelIcon /> Cancel</button>
        <button disabled={disableButtons} onclick={onSave} type="button"><SaveIcon /> Save</button>
    {/snippet}

    {#snippet imageHtml()}
        <CropThumbnail bind:this={cropper} {media} />
    {/snippet}
</MediaPageLayout>
