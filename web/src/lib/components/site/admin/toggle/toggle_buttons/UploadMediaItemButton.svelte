<!--
  @component

  Button to upload a single media item to replace existing media item (image or video)
-->
<script lang="ts">
    import { page } from '$app/state';
    import UploadIcon from '$lib/components/site/icons/UploadIcon.svelte';
    import { albumState } from '$lib/stores/AlbumState.svelte';
    import { uploadMachine } from '$lib/stores/admin/UploadMachine.svelte';
    import { getParentFromPath, isValidMediaPath, validMediaExtensionsString } from '$lib/utils/galleryPathUtils';
    import { getReplacementExtensionError, getUploadPathForReplacement } from '$lib/utils/uploadUtils';
    import { toast } from '@zerodevx/svelte-toast';
    import ControlStripButton from '../../edit_controls/buttons/ControlStripButton.svelte';

    let mediaPath = $derived(page.url.pathname);
    let show = $derived(isValidMediaPath(page.url.pathname)); // Show this button only on media pages
    let albumPath = $derived(getParentFromPath(mediaPath));
    let media = $derived(albumState.albums.get(albumPath)?.album?.getMedia(mediaPath));

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
        const extensionError = getReplacementExtensionError(mediaPath, file.name);
        if (extensionError !== undefined) {
            toast.push(extensionError);
            return;
        }
        const uploadPath = getUploadPathForReplacement(mediaPath, file.name);
        uploadMachine.uploadMediaItem(uploadPath, file, media?.versionId, mediaPath);
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
        accept={validMediaExtensionsString()}
        onchange={onFileSelected}
        type="file"
    />
{/if}
