<!--
  @component 
  
  A cancel button
-->
<script lang="ts">
    import CancelIcon from '$lib/components/site/icons/CancelIcon.svelte';
    import ControlStripButton from './ControlStripButton.svelte';

    interface Props {
        disabled?: boolean | undefined;
        onclick?: ((event: MouseEvent) => void) | undefined;
    }

    let { disabled = false, onclick }: Props = $props();
</script>

<ControlStripButton {disabled} {onclick}><CancelIcon /> Cancel</ControlStripButton>
