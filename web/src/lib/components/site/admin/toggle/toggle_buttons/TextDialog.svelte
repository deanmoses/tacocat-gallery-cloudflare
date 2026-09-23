<!--
  @component 
  
  Dialog to get a text input from user, such as a new album name 
-->
<script lang="ts">
    import Dialog from '../../Dialog.svelte';
    import CancelIcon from '$lib/components/site/icons/CancelIcon.svelte';
    import SaveIcon from '$lib/components/site/icons/SaveIcon.svelte';

    interface Props {
        label: string;
        initialValue: string;
        extension?: string | undefined;
        sanitizor: (n: string) => string;
        validator: (n: string) => Promise<string | undefined>;
        onNewValue: (n: string) => void;
    }

    let { label, initialValue, extension = '', sanitizor, validator, onNewValue }: Props = $props();
    let dialog: { show: () => void; close: () => void } | undefined = $state();
    let textfield: HTMLInputElement | undefined = $state();
    let errorMsg: string | undefined = $state();

    export function show(): void {
        dialog?.show();
    }

    function onTextChange(): void {
        if (textfield === undefined) return;
        if (textfield.value) {
            textfield.value = sanitizor(textfield.value);
        }
    }

    async function onSubmit(event: Event): Promise<void> {
        event.preventDefault();
        if (textfield === undefined || textfield.value === '') return;
        const validationErrorMsg = await validator(textfield.value);
        if (validationErrorMsg !== undefined) {
            errorMsg = validationErrorMsg;
            return;
        }
        dialog?.close();
        onNewValue(textfield.value);
    }

    function onCancelButtonClick(): void {
        dialog?.close();
    }

    function onkeydown(event: KeyboardEvent): void {
        switch (event.key) {
            case 'Enter':
                event.preventDefault();
                void onSubmit(event);
                break;
            // Prevent arrow keys from navigating to the prev/next photo or parent album
            case 'ArrowLeft':
            case 'ArrowRight':
            case 'ArrowUp':
                event.stopPropagation();
        }
    }
</script>

<Dialog bind:this={dialog} {onkeydown}>
    {#snippet content()}
        <label>
            <div class="label">{label}</div>
            <input
                bind:this={textfield}
                name="text"
                oninput={onTextChange}
                required
                type="text"
                value={initialValue}
            />{extension}
            {#if errorMsg}
                <div class="error-msg">{errorMsg}</div>
            {/if}
        </label>
    {/snippet}
    {#snippet buttons()}
        <button onclick={onCancelButtonClick} type="button"><CancelIcon /> Cancel</button>
        <button onclick={onSubmit} type="button"><SaveIcon /> Confirm</button>
    {/snippet}
</Dialog>

<style>
    .label {
        margin-bottom: 0.3em;
    }

    .error-msg {
        font-style: italic;
        color: rgb(58 59 59);
    }
</style>
