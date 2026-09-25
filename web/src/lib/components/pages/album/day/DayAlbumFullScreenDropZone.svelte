<!--
  @component

  Paints a full screen drag/drop zone over the day album page.
-->
<script lang="ts">
    import FullScreenDropZone from '$lib/components/site/admin/FullScreenDropZone.svelte';
    import UploadReplaceConfirmDialog from '$lib/components/site/admin/toggle/toggle_buttons/UploadReplaceConfirmDialog.svelte';
    import { getDroppedFiles } from '$lib/stores/admin/DragDropUtils';
    import { getSanitizedFiles, uploadMachine } from '$lib/stores/admin/UploadMachine.svelte';
    import type { MediaItemToUpload } from '$lib/models/album';
    import { sessionStore } from '$lib/stores/SessionStore.svelte';
    import { albumState } from '$lib/stores/AlbumState.svelte';
    import { markReplacements } from '$lib/utils/uploadUtils';

    interface Props {
        albumPath: string;
        /** So that the edit page can tell me whether it allows dropping */
        allowDrop?: boolean | undefined;
    }

    let { albumPath, allowDrop = true }: Props = $props();

    /** What this page asks of the confirm dialog it binds to */
    interface ConfirmDialog {
        show: (collidingNames: string[]) => void;
    }

    let dialog: ConfirmDialog | undefined = $state();

    let imagesToUpload: MediaItemToUpload[] = $state([]);

    function isDropAllowed(event: DragEvent): boolean {
        return allowDrop && sessionStore.isAdmin && Boolean(event.dataTransfer?.types.includes('Files'));
    }

    async function onDrop(event: DragEvent): Promise<void> {
        const files = await getDroppedFiles(event);
        imagesToUpload = getSanitizedFiles(files, albumPath);
        if (!imagesToUpload.length) return;
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

<FullScreenDropZone {isDropAllowed} {onDrop}>Drop images and videos or a 📁</FullScreenDropZone>
<UploadReplaceConfirmDialog bind:this={dialog} {onConfirm} />
