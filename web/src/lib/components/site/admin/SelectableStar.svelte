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

    function onEmptyStarClick(): void {
        selecting = true;
        if (onSelected) {
            onSelected(path);
        }
    }
</script>

{#if selected}
    <div class="selected"><FilledStarIcon height="2em" width="2em" /></div>
{:else if selecting}
    <div class="selecting"><TransitionStarIcon onclick={onEmptyStarClick} /></div>
{:else}
    <div class="not-selected"><EmptyStarIcon onclick={onEmptyStarClick} /></div>
{/if}

<style>
    div {
        position: absolute;
        top: 10px;
        left: 10px;
    }

    .selected,
    .selecting {
        color: #ffff00;
    }

    .not-selected {
        color: #ffffff;
        display: none;
    }

    .not-selected:hover {
        color: #ffff00;
    }
</style>
