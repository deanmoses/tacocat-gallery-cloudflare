<!--
  @component

  Page to drag a day album's media into an order of the admin's own
-->
<script lang="ts">
    import { flip } from 'svelte/animate';
    import { type DndEvent, dndzone } from 'svelte-dnd-action';
    import { mediaKey } from '@tacocat-gallery/shared';
    import DayAlbumPageLayout from './DayAlbumPageLayout.svelte';
    import EditControlsLayout from '$lib/components/site/admin/edit_controls/EditControlsLayout.svelte';
    import CancelButton from '$lib/components/site/admin/edit_controls/buttons/CancelButton.svelte';
    import ControlStripButton from '$lib/components/site/admin/edit_controls/buttons/ControlStripButton.svelte';
    import SaveButton from '$lib/components/site/admin/edit_controls/buttons/SaveButton.svelte';
    import MediaThumbnail from '$lib/components/site/MediaThumbnail.svelte';
    import type { Album, Media } from '$lib/models/GalleryItemInterfaces';
    import { ReorderStatus } from '$lib/models/album';
    import { albumReorderMachine } from '$lib/stores/admin/AlbumReorderMachine.svelte';
    import { albumState } from '$lib/stores/AlbumState.svelte';

    interface Props {
        album: Album;
    }
    let { album }: Props = $props();

    /** The library keys each draggable by `id` */
    interface Item {
        id: string;
        media: Media;
    }

    const FLIP_DURATION_MS = 200;

    let path: string = $derived(album.path);
    // Starts in the album's order, and starts again from it when the album is re-read, as when an upload finishes
    let items: Item[] = $derived(album.media.map((media) => ({ id: media.path, media })));
    let saving: boolean = $derived(albumState.albumReorders.get(path)?.status === ReorderStatus.SAVING);
    // Dragging things back where they were changes nothing, so an album in name order stays in name order
    let changed: boolean = $derived(items.some((item, index) => item.id !== album.media[index]?.path));

    // Leaving the page by the browser's back button leaves reordering too
    $effect((): (() => void) => {
        const leaving = path;
        return () => {
            albumReorderMachine.cancelReordering(leaving);
        };
    });

    function onDrag(event: CustomEvent<DndEvent<Item>>): void {
        items = event.detail.items;
    }

    function onCancel(): void {
        albumReorderMachine.cancelReordering(path);
    }

    function onSave(): void {
        albumReorderMachine.saveOrder(
            path,
            items.flatMap((item) => mediaKey(item.id)?.itemName ?? []),
        );
    }

    function onReset(): void {
        albumReorderMachine.saveOrder(path, null);
    }
</script>

<DayAlbumPageLayout published={album.published} title={album.title}>
    {#snippet editControls()}
        <EditControlsLayout>
            {#snippet leftControls()}
                <CancelButton disabled={saving} onclick={onCancel} />
            {/snippet}

            {#snippet status()}
                {saving ? 'Saving…' : 'Drag the photos into order'}
            {/snippet}

            {#snippet rightControls()}
                {#if album.reordered}
                    <ControlStripButton disabled={saving} onclick={onReset} title="Put the photos back in name order">
                        Reset order
                    </ControlStripButton>
                {/if}
                <SaveButton hasUnsavedChanges={changed && !saving} onclick={onSave} />
            {/snippet}
        </EditControlsLayout>
    {/snippet}

    {#snippet thumbnails()}
        <div
            class="grid"
            aria-label="Photos in album order"
            onconsider={onDrag}
            onfinalize={onDrag}
            use:dndzone={{ items, flipDurationMs: FLIP_DURATION_MS, delayTouchStart: true, dragDisabled: saving }}
        >
            {#each items as item (item.id)}
                <div class="item" aria-label={item.media.title} animate:flip={{ duration: FLIP_DURATION_MS }}>
                    <MediaThumbnail
                        mediaType={item.media.mediaType}
                        summary={item.media.summary}
                        thumbnailUrlInfo={item.media.thumbnailUrlInfo}
                        title={item.media.title}
                    />
                </div>
            {/each}
        </div>
    {/snippet}
</DayAlbumPageLayout>

<style>
    .grid {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--default-padding) * 2);
        width: 100%;
    }

    @media (width <= 456px) {
        .grid {
            justify-content: center;
        }
    }

    .item {
        cursor: grab;
        user-select: none;
    }

    /* The thumbnail's links would navigate, and a long press on its image would open the phone's image menu */
    .item :global(a) {
        pointer-events: none;
    }
</style>
