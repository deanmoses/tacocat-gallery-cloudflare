<!--
  @component 
  
  Button to create new day album
-->
<script lang="ts">
    import { goto } from '$app/navigation';
    import { page } from '$app/state';
    import CreateIcon from '$lib/components/site/icons/CreateIcon.svelte';
    import { albumLoadMachine } from '$lib/stores/AlbumLoadMachine.svelte';
    import { albumCreateMachine } from '$lib/stores/admin/AlbumCreateMachine.svelte';
    import { sanitizeAlbumName } from '$lib/utils/albumName';
    import { albumPath, isDayAlbumPath, isYearAlbumPath, pathOfUrl } from 'tacocat-gallery-shared';
    import ControlStripButton from '../../edit_controls/buttons/ControlStripButton.svelte';
    import TextDialog from './TextDialog.svelte';

    let yearPath: string = $derived(pathOfUrl(page.url.pathname));
    let show: boolean = $derived(isYearAlbumPath(yearPath)); // Show this button only on year albums

    let dialog: { show: () => void } | undefined = $state();

    function todayAlbumName(): string {
        const d = new Date();
        const month = `0${d.getMonth() + 1}`.slice(-2);
        const day = `0${d.getDate()}`.slice(-2);
        return `${month}-${day}`;
    }

    function onButtonClick(): void {
        dialog?.show();
    }

    function onNewAlbumName(newAlbumName: string): void {
        const newAlbumPath = albumNameToPath(newAlbumName);
        albumCreateMachine.createAlbum(newAlbumPath);
        void goto(newAlbumPath);
    }

    async function validateDayAlbumName(albumName: string): Promise<string | undefined> {
        const newAlbumPath = albumNameToPath(albumName);
        if (!isDayAlbumPath(newAlbumPath)) return 'invalid album name';
        if (await albumLoadMachine.albumExists(newAlbumPath)) return 'already exists';
        return undefined; // name is valid
    }

    function albumNameToPath(albumName: string): string {
        return albumPath(yearPath, albumName);
    }
</script>

{#if show}
    <ControlStripButton onclick={onButtonClick}><CreateIcon />New Album</ControlStripButton>
    <TextDialog
        bind:this={dialog}
        initialValue={todayAlbumName()}
        label="New Album Name"
        onNewValue={onNewAlbumName}
        sanitizor={sanitizeAlbumName}
        validator={validateDayAlbumName}
    />
{/if}
