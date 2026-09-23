<!--
  @component

  Controls for editing albums
-->
<script lang="ts">
    import { draftMachine } from '$lib/stores/admin/DraftMachine.svelte';
    import BaseEditControls from './BaseEditControls.svelte';

    interface Props {
        /** Whether album is published or not */
        published?: boolean | undefined;

        /** Show the summary field.  Should only be shown on day albums, not year albums */
        showSummary?: boolean | undefined;

        summary?: string | undefined;
    }

    let { published = false, showSummary = false, summary = '' }: Props = $props();

    function onSummaryChange(event: Event & { currentTarget: EventTarget & HTMLInputElement }) {
        if (event.target) draftMachine.setSummary(event.currentTarget.value);
    }

    function onPublishedChange(event: Event & { currentTarget: EventTarget & HTMLInputElement }) {
        if (event.target) draftMachine.setPublished(event.currentTarget.checked);
    }
</script>

<BaseEditControls>
    {#snippet rightControls()}
        {#if showSummary}
            <div>
                <input name="text" oninput={onSummaryChange} type="text" value={summary ?? ''} />
            </div>
        {/if}
        <div>
            <input name="check" checked={published} onchange={onPublishedChange} type="checkbox" /> published
        </div>
    {/snippet}
</BaseEditControls>
