<!--
  @component

  Button to upload multiple media items (images or videos) on a day album page
-->
<script lang="ts">
    import { page } from '$app/state';
    import UploadIcon from '$lib/components/site/icons/UploadIcon.svelte';
    import type { MediaItemToUpload } from '$lib/models/album';
    import { albumState } from '$lib/stores/AlbumState.svelte';
    import { getSanitizedFiles, uploadMachine } from '$lib/stores/admin/UploadMachine.svelte';
    import { isValidDayAlbumPath, validMediaExtensionsString } from '$lib/utils/galleryPathUtils';
    import { markReplacements } from '$lib/utils/uploadUtils';
    import ControlStripButton from '../../edit_controls/buttons/ControlStripButton.svelte';
    import UploadReplaceConfirmDialog from './UploadReplaceConfirmDialog.svelte';

    let albumPath = $derived(`${page.url.pathname}/`);
    let show = $derived(isValidDayAlbumPath(albumPath)); // Show this button only on day ablums

    let fileInput: HTMLInputElement | undefined = $state();
    let dialog: { show: (files: string[]) => void } | undefined = $state();
    let imagesToUpload: MediaItemToUpload[] = $state([]);

    function onUploadButtonClick(): void {
        fileInput?.click();
    }

    function onFilesSelected(): void {
        const files = fileInput?.files;
        if (!files) return;
        if (!isValidDayAlbumPath(albumPath)) throw new Error(`Invalid day album path: [${albumPath}]`);
        console.log(`I'll upload [${files.length}] images to album [${albumPath}]`);
        imagesToUpload = getSanitizedFiles(files, albumPath);
        const album = albumState.albums.get(albumPath)?.album;
        const collidingNames = markReplacements(imagesToUpload, album);
        if (collidingNames.length > 0) {
            dialog?.show(collidingNames);
        } else {
            uploadMachine.uploadMediaItems(albumPath, imagesToUpload);
        }
    }

    function onConfirm(): void {
        uploadMachine.uploadMediaItems(albumPath, imagesToUpload);
    }
</script>

{#if show}
    <ControlStripButton onclick={onUploadButtonClick}><UploadIcon />Upload</ControlStripButton>
    <input
        bind:this={fileInput}
        style:display="none"
        accept={validMediaExtensionsString()}
        multiple
        onchange={onFilesSelected}
        type="file"
    />
    <UploadReplaceConfirmDialog bind:this={dialog} {onConfirm} />
{/if}
