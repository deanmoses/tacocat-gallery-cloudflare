<!--
  @component 
  
  Full screen zone for dropping images into an album or replacing a single image
-->
<script lang="ts">
    import type { Snippet } from 'svelte';

    interface Props {
        isDropAllowed: (event: DragEvent) => boolean;
        onDrop: (event: DragEvent) => Promise<void>;
        children?: Snippet | undefined;
    }

    let { isDropAllowed, onDrop, children }: Props = $props();

    let dragging = $state(false);

    function ondragenter(event: DragEvent): void {
        if (!isDropAllowed(event)) return;
        event.preventDefault();
        dragging = true;
    }

    function ondragover(event: DragEvent): void {
        if (!isDropAllowed(event)) return;
        event.preventDefault();
    }

    function ondragleave(): void {
        dragging = false;
    }

    async function ondrop(event: DragEvent): Promise<void> {
        if (!isDropAllowed(event)) return;
        event.preventDefault();
        dragging = false;
        await onDrop(event);
    }
</script>

{#if dragging}
    <p {ondragleave} {ondragover} {ondrop}>
        {@render children?.()}
    </p>
{/if}
<svelte:window {ondragenter} {ondragover} />

<style>
    p {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 3em;
        z-index: 5;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: rgb(255 255 255 / 80%);
        font-size: 3em;
        color: rgb(78 78 78);
        border-color: rgb(78 78 78);
        border-style: dashed;
        border-width: 3px;
    }
</style>
