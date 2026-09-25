<!--
  @component 
  
  Star that allows for selection.  Meant to be used in a thumbnail
-->
<script lang="ts">
    import EmptyStarIcon from '../icons/EmptyStarIcon.svelte';
    import FilledStarIcon from '../icons/FilledStarIcon.svelte';
    import TransitionStarIcon from '../icons/TransitionStarIcon.svelte';

    interface Props {
        path: string;
        albumThumbPath: string | undefined;
        onSelected?: ((path: string) => void) | undefined;
    }

    let { path, albumThumbPath, onSelected }: Props = $props();

    let selected: boolean = $derived(path === albumThumbPath);

    let selecting: boolean = $state(false);
    let previouslySelected: boolean | undefined = $state();
    // A change to `selected`, in either direction, is the store answering the click, so the transition ends
    $effect(() => {
        if (selected === previouslySelected) return;
        previouslySelected = selected;
        selecting = false;
    });

    function onStarClick(): void {
        selecting = true;
        if (onSelected) {
            onSelected(path);
        }
    }
</script>

{#if selected}
    <div class="selected"><FilledStarIcon height="2em" width="2em" /></div>
{:else}
    <button
        class={selecting ? 'selecting' : 'not-selected'}
        aria-label="Set as album thumbnail"
        onclick={onStarClick}
        type="button"
    >
        {#if selecting}<TransitionStarIcon />{:else}<EmptyStarIcon />{/if}
    </button>
{/if}

<style>
    div,
    button {
        position: absolute;
        top: 10px;
        left: 10px;
    }

    button {
        padding: 0;
        border: 0;
        background: none;
        font-size: inherit;
        line-height: 0;
        cursor: pointer;
    }

    .selected,
    .selecting {
        color: #ffff00;
    }

    /* Faded rather than removed, so a keyboard can still reach it; the edit page shows it when its thumbnail is hovered */
    .not-selected {
        color: #ffffff;
        opacity: 0;
    }

    .not-selected:hover {
        color: #ffff00;
    }

    .not-selected:focus-visible {
        opacity: 1;
    }
</style>
