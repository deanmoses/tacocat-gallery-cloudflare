<!--
  @component

  Button to delete a media item (image or video)
-->
<script lang="ts">
    import { goto } from '$app/navigation';
    import { page } from '$app/state';
    import DeleteIcon from '$lib/components/site/icons/DeleteIcon.svelte';
    import { mediaDeleteMachine } from '$lib/stores/admin/MediaDeleteMachine.svelte';
    import { isMediaPath, parentPathOf } from '@tacocat-gallery/shared';
    import ControlStripButton from '../../edit_controls/buttons/ControlStripButton.svelte';

    let imagePath: string = $derived(page.url.pathname);
    let show: boolean = $derived(isMediaPath(imagePath)); // Show this button on media pages (images and videos)

    function onDeleteButtonClick(): void {
        mediaDeleteMachine.delete(imagePath);
        void goto(parentPathOf(imagePath));
    }
</script>

{#if show}
    <ControlStripButton onclick={onDeleteButtonClick}><DeleteIcon />Delete</ControlStripButton>
{/if}
