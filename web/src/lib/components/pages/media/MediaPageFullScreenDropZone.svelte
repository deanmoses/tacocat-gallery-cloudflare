<!--
  @component 

  Full screen drag/drop zone for dropping a replacement file onto the media page.
-->
<script lang="ts">
    import FullScreenDropZone from '$lib/components/site/admin/FullScreenDropZone.svelte';
    import { getDroppedFiles } from '$lib/stores/admin/DragDropUtils';
    import { uploadMachine } from '$lib/stores/admin/UploadMachine.svelte';
    import { sessionStore } from '$lib/stores/SessionStore.svelte';
    import { getReplacementExtensionError, getUploadPathForReplacement } from '$lib/utils/uploadUtils';
    import { toast } from '@zerodevx/svelte-toast';

    interface Props {
        mediaPath: string;
        /** Current versionId of the media being replaced (for detecting when replacement is complete) */
        versionId?: string | undefined;
        /** So that the edit page can tell me whether it allows dropping */
        allowDrop?: boolean | undefined;
    }

    let { mediaPath, versionId, allowDrop = true }: Props = $props();

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
        const extensionError = getReplacementExtensionError(mediaPath, file.name);
        if (extensionError !== undefined) {
            toast.push(extensionError);
            return;
        }
        const uploadPath = getUploadPathForReplacement(mediaPath, file.name);
        uploadMachine.uploadMediaItem(uploadPath, file, versionId);
    }
</script>

<FullScreenDropZone {isDropAllowed} {onDrop}>Drop a replacement file</FullScreenDropZone>
