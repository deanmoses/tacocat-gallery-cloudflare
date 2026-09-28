<!--
  @component 
  
  Button to rename a day album
-->
<script lang="ts">
    import { page } from '$app/state';
    import RenameIcon from '$lib/components/site/icons/RenameIcon.svelte';
    import { albumLoadMachine } from '$lib/stores/AlbumLoadMachine.svelte';
    import { sanitizeAlbumName } from '$lib/utils/albumName';
    import { albumKey, albumPath, isDayAlbumPath, parentPathOf, pathOfUrl } from '@tacocat-gallery/shared';
    import ControlStripButton from '../../edit_controls/buttons/ControlStripButton.svelte';
    import TextDialog from './TextDialog.svelte';
    import { albumRenameMachine } from '$lib/stores/admin/AlbumRenameMachine.svelte';

    let dayPath: string = $derived(pathOfUrl(page.url.pathname));
    let show: boolean = $derived(isDayAlbumPath(dayPath)); // Show this button only on day albums
    let dialog: { show: () => void } | undefined = $state();

    function originalName(): string {
        return albumKey(dayPath)?.itemName ?? '';
    }

    function onButtonClick(): void {
        dialog?.show();
    }

    function onNewAlbumName(newAlbumName: string): void {
        const newAlbumPath = albumNameToPath(newAlbumName);
        albumRenameMachine.renameDayAlbum(dayPath, newAlbumPath);
    }

    async function validateDayAlbumName(albumName: string): Promise<string | undefined> {
        const newAlbumPath = albumNameToPath(albumName);
        if (!isDayAlbumPath(newAlbumPath)) return 'invalid album name';
        if (await albumLoadMachine.albumExists(newAlbumPath)) return 'already exists';
        return undefined; // name is valid
    }

    function albumNameToPath(albumName: string): string {
        return albumPath(parentPathOf(dayPath), albumName);
    }
</script>

{#if show}
    <ControlStripButton onclick={onButtonClick} title="Rename album on disk"><RenameIcon />Rename</ControlStripButton>
    <TextDialog
        bind:this={dialog}
        initialValue={originalName()}
        label="New Album Name"
        onNewValue={onNewAlbumName}
        sanitizor={sanitizeAlbumName}
        validator={validateDayAlbumName}
    />
{/if}
