<!--
  @component

  Button to rename a media item (image or video)
-->
<script lang="ts">
    import { page } from '$app/state';
    import RenameIcon from '$lib/components/site/icons/RenameIcon.svelte';
    import { isValidMediaNameWithoutExtensionStrict } from '$lib/utils/galleryPathUtils';
    import {
        baseNameOf,
        extensionOf,
        isMediaPath,
        mediaKey,
        mediaPath as mediaPathOf,
        parentPathOf,
        sanitizeMediaBaseName,
    } from 'tacocat-gallery-shared';
    import ControlStripButton from '../../edit_controls/buttons/ControlStripButton.svelte';
    import TextDialog from './TextDialog.svelte';
    import { mediaRenameMachine } from '$lib/stores/admin/MediaRenameMachine.svelte';
    import { albumState } from '$lib/stores/AlbumState.svelte';

    let mediaPath: string = $derived(page.url.pathname);
    let show: boolean = $derived(isMediaPath(mediaPath)); // Show this button on media (images and videos)
    let mediaName: string = $derived(mediaKey(mediaPath)?.itemName ?? '');
    let dialog: { show: () => void } | undefined = $state();

    function originalMediaName(): string {
        return baseNameOf(mediaName);
    }

    function fileExtension(): string {
        return `.${extensionOf(mediaName)}`;
    }

    function onButtonClick(): void {
        dialog?.show();
    }

    function onNewMediaName(newMediaName: string): void {
        const newMediaPath = mediaNameWithoutExtensionToPath(newMediaName);
        mediaRenameMachine.renameMediaItem(mediaPath, newMediaPath);
    }

    async function validateMediaName(newMediaName: string): Promise<string | undefined> {
        if (!isValidMediaNameWithoutExtensionStrict(newMediaName)) return 'invalid filename';
        const newMediaPath = mediaNameWithoutExtensionToPath(newMediaName);
        const albumPath = parentPathOf(newMediaPath);
        const album = albumState.albums.get(albumPath);
        if (!album?.album) return undefined; // album not loaded, cannot check for collision
        const media = album.album.getMedia(newMediaPath);
        if (media) return 'file already exists';
        return undefined; // name is valid
    }

    function mediaNameWithoutExtensionToPath(mediaNameWithoutExtension: string): string {
        return mediaPathOf(parentPathOf(mediaPath), mediaNameWithoutExtension + fileExtension());
    }
</script>

{#if show}
    <ControlStripButton onclick={onButtonClick} title="Change name on disk"><RenameIcon />Rename</ControlStripButton>
    <TextDialog
        bind:this={dialog}
        extension={fileExtension()}
        initialValue={originalMediaName()}
        label="New Filename"
        onNewValue={onNewMediaName}
        sanitizor={sanitizeMediaBaseName}
        validator={validateMediaName}
    />
{/if}
