<!--
  @component 
  
  Base dialog component that other components extend
-->
<script lang="ts">
    import type { Snippet } from 'svelte';
    import { portal } from '$lib/actions/portal';

    interface Props {
        content?: Snippet | undefined;
        buttons?: Snippet | undefined;
        onkeydown?: ((event: KeyboardEvent) => void) | undefined;
    }

    let { content, buttons, onkeydown }: Props = $props();
    let dialog: HTMLDialogElement | undefined = $state();

    export function show(): void {
        dialog?.showModal();
    }

    export function close(): void {
        dialog?.close();
    }

    /** Close dialog when user clicks outside it */
    function onClick(event: MouseEvent): void {
        if (dialog === undefined || event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const clickIsOutsideDialog =
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom;
        if (clickIsOutsideDialog) {
            dialog.close();
        }
    }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div use:portal>
    <dialog bind:this={dialog} onclick={onClick}>
        <form method="dialog" {onkeydown}>
            <p>
                {@render content?.()}
            </p>
            <menu>
                {@render buttons?.()}
            </menu>
        </form>
    </dialog>
</div>

<style>
    dialog::backdrop {
        background-image: linear-gradient(45deg, #ff00ff, #663399, #1e90ff, #008000);
        opacity: 0.75;
    }

    dialog {
        border: none;
        box-shadow: #00000029 2px 2px 5px 2px;
        border-radius: 8px;
        padding: 0.5em;
        background-color: rgb(143 143 143);
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
    }
</style>
