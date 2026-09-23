<!--
  @component 
  
  Base for all buttons on the edit control strip
-->
<script lang="ts">
    import type { Snippet } from 'svelte';

    interface Props {
        disabled?: boolean | undefined;
        /** Alt text*/
        title?: string | undefined;
        children?: Snippet | undefined;
        onclick?: (event: MouseEvent) => void | undefined;
    }

    let { disabled = false, title, children, onclick }: Props = $props();
</script>

<button {disabled} {onclick} {title} type="button">{@render children?.()}</button>

<style>
    button {
        display: flex;
        align-items: center;
        gap: 0.3em;
    }
</style>
