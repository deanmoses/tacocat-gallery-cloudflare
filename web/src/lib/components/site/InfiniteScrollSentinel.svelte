<!--
  @component

  Sentinel component for infinite scrolling.
  Triggers a callback when it enters the viewport.
-->
<script lang="ts">
    import { onMount } from 'svelte';

    interface Props {
        onIntersect: () => void;
        disabled?: boolean | undefined;
        rootMargin?: string | undefined;
    }
    let { onIntersect, disabled = false, rootMargin = '200px' }: Props = $props();

    let sentinel: HTMLElement;
    let observer: IntersectionObserver | undefined;
    let hasTriggered = false;
    let wasDisabled = false;

    // New results may or may not push the sentinel out of the viewport, and the observer reports only a change, after
    // the browser has drawn them. Observing afresh makes it report where the sentinel is now, so a list that still
    // ends on screen fetches again, and one that no longer does waits for the reader to scroll.
    $effect(() => {
        if (wasDisabled && !disabled && observer) {
            hasTriggered = false;
            observer.unobserve(sentinel);
            observer.observe(sentinel);
        }
        wasDisabled = disabled;
    });

    onMount(() => {
        observer = new IntersectionObserver(
            (entries) => {
                // Reset trigger flag when sentinel leaves viewport
                if (entries.at(-1)?.isIntersecting !== true) {
                    hasTriggered = false;
                    return;
                }

                // Only trigger once per intersection, and only if not disabled
                if (disabled || hasTriggered) {
                    return;
                }

                hasTriggered = true;
                onIntersect();
            },
            { rootMargin },
        );
        observer.observe(sentinel);
        return (): void => {
            observer?.disconnect();
        };
    });
</script>

<div bind:this={sentinel} class="sentinel"></div>

<style>
    .sentinel {
        height: 1px;
    }
</style>
