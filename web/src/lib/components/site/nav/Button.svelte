<!--
  @component 
  
  Base component for nav buttons
-->
<script lang="ts">
    import type { Snippet } from 'svelte';

    interface Props {
        href?: string | undefined;
        title: string;
        children?: Snippet | undefined;
    }

    let { href = '', title, children }: Props = $props();

    let ariaDisabled: boolean | null = $derived(href === '' || null);
</script>

<a aria-disabled={ariaDisabled} {href} {title}><span>{@render children?.()}</span></a>

<style>
    a {
        flex: 1;
    }

    span {
        height: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
        column-gap: 0.2em;
        background-color: var(--button-color);
        color: var(--default-text-color);
        border: 1px solid #cccccc;
        text-decoration: none;
        padding: 6px 12px;
    }

    [aria-disabled] {
        background-color: #ffffff;
    }

    [aria-disabled] span {
        color: #cccccc;
        cursor: not-allowed;
        opacity: 0.65;
    }
</style>
