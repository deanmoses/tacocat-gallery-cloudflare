<!--
  @component 
  
  Button to drag a day album's media into an order of the admin's own
-->
<script lang="ts">
    import { page } from '$app/state';
    import ReorderIcon from '$lib/components/site/icons/ReorderIcon.svelte';
    import { albumReorderMachine } from '$lib/stores/admin/AlbumReorderMachine.svelte';
    import { albumState } from '$lib/stores/AlbumState.svelte';
    import { isDayAlbumPath, pathOfUrl } from 'tacocat-gallery-shared';
    import ControlStripButton from '../../edit_controls/buttons/ControlStripButton.svelte';

    let dayPath: string = $derived(pathOfUrl(page.url.pathname));
    let mediaCount: number = $derived(
        isDayAlbumPath(dayPath) ? (albumState.albums.get(dayPath)?.album?.media.length ?? 0) : 0,
    );
    let show: boolean = $derived(mediaCount > 1); // Only a day album with something to reorder

    function onclick(): void {
        albumReorderMachine.startReordering(dayPath);
    }
</script>

{#if show}
    <ControlStripButton {onclick} title="Drag photos into order"><ReorderIcon />Reorder</ControlStripButton>
{/if}
