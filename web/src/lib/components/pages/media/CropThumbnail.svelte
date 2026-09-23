<!--
    @component

    An image cropper to crop the thumbnail of a media item
-->
<script lang="ts">
    import Cropper, { type OnCropCompleteEvent } from 'svelte-easy-crop';
    import type { Media } from '$lib/models/GalleryItemInterfaces';

    interface Crop {
        x: number;
        y: number;
        height: number;
        width: number;
    }
    interface Props {
        media: Media;
    }

    let { media }: Props = $props();
    export function getCrop(): Crop {
        return newCrop;
    }

    let newCrop: Crop;

    function onCropChange(event: OnCropCompleteEvent): void {
        console.log('onCropChange', event.percent);
        newCrop = event.percent;
    }
</script>

<div class="crop-container">
    <Cropper aspect={1} image={media.detailUrl} oncropcomplete={onCropChange} showGrid={false} />
</div>

<style>
    .crop-container {
        position: relative;
        width: 100%;
        min-height: 400px;
        background-color: #ffffff;
    }
</style>
