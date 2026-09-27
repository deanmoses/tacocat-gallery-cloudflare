<!--
  @component 
  
  Button to delete album
-->
<script lang="ts">
    import { goto } from '$app/navigation';
    import { page } from '$app/state';
    import DeleteIcon from '$lib/components/site/icons/DeleteIcon.svelte';
    import type { AlbumEntry } from '$lib/models/album';
    import { albumDeleteMachine } from '$lib/stores/admin/AlbumDeleteMachine.svelte';
    import { albumState } from '$lib/stores/AlbumState.svelte';
    import { isDayAlbumPath, isYearAlbumPath, parentPathOf, pathOfUrl } from 'tacocat-gallery-shared';
    import ControlStripButton from '../../edit_controls/buttons/ControlStripButton.svelte';

    let albumPath = $derived(pathOfUrl(page.url.pathname));
    let isValidPath = $derived(isDayAlbumPath(albumPath) || isYearAlbumPath(albumPath));
    let albumEntry = $derived(albumState.albums.get(albumPath));
    // Show this button on year and day albums but not root albums, and only if they don't have children
    let show: boolean = $derived(isValidPath && !hasChildren(albumEntry));

    function hasChildren(entry: AlbumEntry | undefined): boolean {
        return Boolean(entry?.album?.albums.length) || Boolean(entry?.album?.media.length);
    }

    function onDeleteButtonClick(): void {
        albumDeleteMachine.deleteAlbum(albumPath);
        void goto(parentPathOf(albumPath));
    }
</script>

{#if show}
    <ControlStripButton onclick={onDeleteButtonClick}><DeleteIcon />Delete</ControlStripButton>
{/if}
