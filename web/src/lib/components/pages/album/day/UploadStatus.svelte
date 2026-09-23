<!--
  @component 
  
  Widget that displays the status of the uploads
-->
<script lang="ts">
    import { type UploadEntry, UploadState } from '$lib/models/album';

    interface Props {
        uploads?: UploadEntry[] | undefined;
    }

    let { uploads }: Props = $props();

    let uploadingCount: number = $derived(
        uploads ? uploads.reduce((acc, upload) => acc + (upload.status === UploadState.UPLOADING ? 1 : 0), 0) : 0,
    );

    let processingCount: number = $derived(
        uploads ? uploads.reduce((acc, upload) => acc + (upload.status === UploadState.PROCESSING ? 1 : 0), 0) : 0,
    );
</script>

{#if uploadingCount}{uploadingCount} uploading <span>📤</span>{#if processingCount},{/if}{/if}
{#if processingCount}{processingCount} processing <span>🕒</span>{/if}

<style>
    span {
        filter: grayscale(100%);
    }
</style>
