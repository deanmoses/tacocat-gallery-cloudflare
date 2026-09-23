<!--
  @component 
  
  Dialog to confirm overwriting files
-->
<script lang="ts">
    import Dialog from '../../Dialog.svelte';
    import CancelIcon from '$lib/components/site/icons/CancelIcon.svelte';
    import UploadIcon from '$lib/components/site/icons/UploadIcon.svelte';

    interface Props {
        /** Callback to be called when the user confirms */
        onConfirm?: (() => void) | undefined;
    }

    let { onConfirm }: Props = $props();

    let dialog: { show: () => void; close: () => void } | undefined = $state();
    let filesAlreadyInAlbum: string[] = $state([]);
    let filez = $derived(filesAlreadyInAlbum.join(', '));

    export function show(files: string[]): void {
        filesAlreadyInAlbum = files;
        dialog?.show();
    }

    function onSubmit(event?: Event): void {
        event?.preventDefault();
        dialog?.close();
        filesAlreadyInAlbum = [];
        if (onConfirm) onConfirm();
    }

    function onCancelButtonClick(): void {
        dialog?.close();
        filesAlreadyInAlbum = [];
    }

    function onkeydown(event: KeyboardEvent): void {
        switch (event.key) {
            case 'Enter':
                event.preventDefault();
                onSubmit();
        }
    }
</script>

<Dialog bind:this={dialog} {onkeydown}>
    {#snippet content()}
        Already in album: {filez}
    {/snippet}
    {#snippet buttons()}
        <button onclick={onCancelButtonClick} type="button"><CancelIcon /> Cancel</button>
        <button onclick={onSubmit} type="button"><UploadIcon /> Overwrite</button>
    {/snippet}
</Dialog>
