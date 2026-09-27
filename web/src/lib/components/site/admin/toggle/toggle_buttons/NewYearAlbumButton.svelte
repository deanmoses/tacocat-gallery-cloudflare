<!--
  @component 
  
  Button to create new year album
-->
<script lang="ts">
    import { goto } from '$app/navigation';
    import { page } from '$app/state';
    import CreateIcon from '$lib/components/site/icons/CreateIcon.svelte';
    import { albumCreateMachine } from '$lib/stores/admin/AlbumCreateMachine.svelte';
    import { albumLoadMachine } from '$lib/stores/AlbumLoadMachine.svelte';
    import { sanitizeAlbumName } from '$lib/utils/albumName';
    import { albumPath, isYearAlbumPath } from 'tacocat-gallery-shared';
    import ControlStripButton from '../../edit_controls/buttons/ControlStripButton.svelte';
    import TextDialog from './TextDialog.svelte';

    let show: boolean = $derived(page.url.pathname === '/'); // Show this button only on root album
    let dialog: { show: () => void } | undefined = $state();

    function yearAlbumName(): string {
        const d = new Date();
        return d.getFullYear().toString();
    }

    function onButtonClick(): void {
        dialog?.show();
    }

    function onNewAlbumName(newAlbumName: string): void {
        const newAlbumPath = albumPath('/', newAlbumName);
        albumCreateMachine.createAlbum(newAlbumPath);
        void goto(newAlbumPath);
    }

    async function validateYearAlbumName(albumName: string): Promise<string | undefined> {
        const newAlbumPath = albumPath('/', albumName);
        if (!isYearAlbumPath(newAlbumPath)) return 'not a year, bruh';
        if (await albumLoadMachine.albumExists(newAlbumPath)) return 'already exists';
        return undefined; // name is valid
    }
</script>

{#if show}
    <ControlStripButton onclick={onButtonClick}><CreateIcon />New Year Album</ControlStripButton>
    <TextDialog
        bind:this={dialog}
        initialValue={yearAlbumName()}
        label="New Year!"
        onNewValue={onNewAlbumName}
        sanitizor={sanitizeAlbumName}
        validator={validateYearAlbumName}
    />
{/if}
