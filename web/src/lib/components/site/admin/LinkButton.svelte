<!--
  @component

  A button drawn as a link
-->
<script lang="ts">
    import type { Snippet } from 'svelte';

    interface Props {
        disabled?: boolean | undefined;
        onclick: () => void;
        children: Snippet;
    }

    let { disabled = false, onclick, children }: Props = $props();
</script>

<button {disabled} {onclick} type="button">{@render children()}</button>

<style>
    button {
        padding: 0;
        border: none;
        background: none;
        color: #337ab7;
        cursor: pointer;
    }

    button:disabled {
        color: var(--default-text-color);
        cursor: default;
        opacity: 0.6;
    }
</style>
