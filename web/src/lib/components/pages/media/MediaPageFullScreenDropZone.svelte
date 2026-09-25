<!--
  @component 

  Full screen drag/drop zone for dropping a replacement file onto the media page.
-->
<script lang="ts">
    import { goto } from '$app/navigation';
    import FullScreenDropZone from '$lib/components/site/admin/FullScreenDropZone.svelte';
    import { getDroppedFiles } from '$lib/stores/admin/DragDropUtils';
    import { uploadMachine } from '$lib/stores/admin/UploadMachine.svelte';
    import { sessionStore } from '$lib/stores/SessionStore.svelte';
    import { getParentFromPath } from '$lib/utils/galleryPathUtils';
    import { replacementPath } from '$lib/utils/uploadUtils';
    import { toast } from '@zerodevx/svelte-toast';

    interface Props {
        mediaPath: string;
        /** So that the edit page can tell me whether it allows dropping */
        allowDrop?: boolean | undefined;
    }

    let { mediaPath, allowDrop = true }: Props = $props();

    function isDropAllowed(event: DragEvent): boolean {
        return allowDrop && sessionStore.isAdmin && Boolean(event.dataTransfer?.types.includes('Files'));
    }

    async function onDrop(event: DragEvent): Promise<void> {
        const files = await getDroppedFiles(event);
        const file = files[0];
        if (files.length !== 1 || file === undefined) {
            toast.push('Please drop a single file');
            return;
        }
        const path = replacementPath(mediaPath, file.name);
        uploadMachine.uploadMediaItem(path, file, mediaPath);
        // A file in another format renames the item, so this page's URL is about to go stale; the album shows the upload
        if (path !== mediaPath) void goto(getParentFromPath(mediaPath));
    }
</script>

<FullScreenDropZone {isDropAllowed} {onDrop}>Drop a replacement file</FullScreenDropZone>
