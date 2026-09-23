<!--
  @component 
  
  A save button
-->
<script lang="ts">
    import SaveIcon from '$lib/components/site/icons/SaveIcon.svelte';
    import ControlStripButton from './ControlStripButton.svelte';

    interface Props {
        hasUnsavedChanges: boolean;
        onclick?: ((event: MouseEvent) => void) | undefined;
    }

    let { hasUnsavedChanges, onclick }: Props = $props();
</script>

<ControlStripButton disabled={!hasUnsavedChanges} {onclick}>
    <SaveIcon /> Save{#if hasUnsavedChanges}*{/if}
</ControlStripButton>
