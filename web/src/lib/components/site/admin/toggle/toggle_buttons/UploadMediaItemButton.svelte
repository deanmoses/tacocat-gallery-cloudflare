<!--
  @component

  Button to upload a single media item to replace existing media item (image or video)
-->
<script lang="ts">
    import { page } from '$app/state';
    import UploadIcon from '$lib/components/site/icons/UploadIcon.svelte';
    import { uploadMachine } from '$lib/stores/admin/UploadMachine.svelte';
    import { acceptedExtensions } from '$lib/utils/fileFormats';
    import { isMediaPath } from '@tacocat-gallery/shared';
    import ControlStripButton from '../../edit_controls/buttons/ControlStripButton.svelte';

    let mediaPath = $derived(page.url.pathname);
    let show = $derived(isMediaPath(mediaPath)); // Show this button only on media pages

    let fileInput: HTMLInputElement | undefined = $state();

    function onUploadButtonClick(): void {
        fileInput?.click();
    }

    function onFileSelected(): void {
        const files = fileInput?.files;
        if (!files || files.length === 0) return;
        // this error should never happen
        if (files.length > 1) throw new Error('Only one file can be uploaded at a time');
        const [file] = files;
        if (file === undefined) return;
        uploadMachine.uploadMediaItem(mediaPath, file, true);
    }
</script>

{#if show}
    <ControlStripButton onclick={onUploadButtonClick} title="Upload new version of image"
        ><UploadIcon />Replace</ControlStripButton
    >
    <input
        bind:this={fileInput}
        id="fileInput"
        style:display="none"
        accept={acceptedExtensions()}
        onchange={onFileSelected}
        type="file"
    />
{/if}
