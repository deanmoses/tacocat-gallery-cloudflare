<!--
  @component

  Button to rename a media item (image or video)
-->
<script lang="ts">
    import { page } from '$app/state';
    import RenameIcon from '$lib/components/site/icons/RenameIcon.svelte';
    import {
        isMediaName,
        isMediaPath,
        mediaKey,
        mediaPath as mediaPathOf,
        parentPathOf,
        sanitizeMediaNameAsTyped,
    } from 'tacocat-gallery-shared';
    import ControlStripButton from '../../edit_controls/buttons/ControlStripButton.svelte';
    import TextDialog from './TextDialog.svelte';
    import { mediaRenameMachine } from '$lib/stores/admin/MediaRenameMachine.svelte';
    import { albumState } from '$lib/stores/AlbumState.svelte';

    let mediaPath: string = $derived(page.url.pathname);
    let show: boolean = $derived(isMediaPath(mediaPath)); // Show this button on media (images and videos)
    let mediaName: string = $derived(mediaKey(mediaPath)?.itemName ?? '');
    let dialog: { show: () => void } | undefined = $state();

    function onButtonClick(): void {
        dialog?.show();
    }

    function onNewMediaName(newMediaName: string): void {
        mediaRenameMachine.renameMediaItem(mediaPath, mediaPathOf(parentPathOf(mediaPath), newMediaName));
    }

    async function validateMediaName(newMediaName: string): Promise<string | undefined> {
        if (!isMediaName(newMediaName)) return 'invalid name';
        const newMediaPath = mediaPathOf(parentPathOf(mediaPath), newMediaName);
        const albumPath = parentPathOf(newMediaPath);
        const album = albumState.albums.get(albumPath);
        if (!album?.album) return undefined; // album not loaded, cannot check for collision
        const media = album.album.getMedia(newMediaPath);
        if (media) return 'file already exists';
        return undefined; // name is valid
    }
</script>

{#if show}
    <ControlStripButton onclick={onButtonClick} title="Change name on disk"><RenameIcon />Rename</ControlStripButton>
    <TextDialog
        bind:this={dialog}
        initialValue={mediaName}
        label="New Filename"
        onNewValue={onNewMediaName}
        sanitizor={sanitizeMediaNameAsTyped}
        validator={validateMediaName}
    />
{/if}
