<!--
  @component

  The base editing controls shared by both albums and media items
-->
<script lang="ts">
    import type { Snippet } from 'svelte';
    import EditControlsLayout from './EditControlsLayout.svelte';
    import CancelButton from './buttons/CancelButton.svelte';
    import SaveButton from './buttons/SaveButton.svelte';
    import StatusMessage from './buttons/StatusMessage.svelte';
    import { DraftStatus } from '$lib/models/draft';
    import { page } from '$app/state';
    import { isValidMediaPath } from '$lib/utils/galleryPathUtils';
    import { draftMachine } from '$lib/stores/admin/DraftMachine.svelte';
    import { editModeMachine } from '$lib/stores/admin/EditModeMachine.svelte';

    interface Props {
        rightControls?: Snippet | undefined;
    }
    let { rightControls }: Props = $props();

    let path: string | undefined = $derived(page.url.pathname);
    let draftStatus: DraftStatus | undefined = $derived(draftMachine.status);
    let hasUnsavedChanges: boolean = $derived(
        draftMachine.status === DraftStatus.UNSAVED_CHANGES || draftMachine.status === DraftStatus.ERRORED,
    );

    // Navigate to new path whenever it changes
    $effect(() => {
        handleNavigation(path);
    });

    const rightControlsFromParent = $derived(rightControls);

    function handleNavigation(pathname: string | undefined): void {
        // Cancel the draft when any navigation happens
        // TODO: there's no reason to do it here, the draft store
        // could subscribe to page.url.pathname itself.
        // I guess the only reason to do it here is that when you're
        // NOT in edit mode, there's no need to listen to it.
        if (pathname === undefined) throw new Error(`path is undefined`);
        const backEndPath = isValidMediaPath(pathname) ? pathname : `${pathname}/`;
        draftMachine.init(backEndPath);
    }

    function onCancelButtonClick(): void {
        editModeMachine.turnOffEditMode();
        draftMachine.cancel();
    }

    function onSaveButtonClick(): void {
        draftMachine.save();
    }
</script>

<EditControlsLayout>
    {#snippet leftControls()}
        <CancelButton onclick={onCancelButtonClick} />
    {/snippet}

    {#snippet status()}
        <StatusMessage status={draftStatus} />
    {/snippet}

    {#snippet rightControls()}
        {@render rightControlsFromParent?.()}
        <SaveButton {hasUnsavedChanges} onclick={onSaveButtonClick} />
    {/snippet}
</EditControlsLayout>
