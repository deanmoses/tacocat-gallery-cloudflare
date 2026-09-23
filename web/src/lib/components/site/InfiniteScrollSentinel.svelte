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
    let hasTriggered = $state(false);
    let isCurrentlyIntersecting = $state(false);
    let prevDisabled: boolean | undefined = $state();

    // When disabled changes from true to false while intersecting, trigger again
    // This handles the case where new results don't push sentinel out of viewport
    $effect(() => {
        if (prevDisabled === true && !disabled && isCurrentlyIntersecting) {
            // Trigger immediately since we're already intersecting and now enabled
            hasTriggered = true;
            onIntersect();
        }
        prevDisabled = disabled;
    });

    onMount(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                isCurrentlyIntersecting = entries[0]?.isIntersecting ?? false;

                // Reset trigger flag when sentinel leaves viewport
                if (!isCurrentlyIntersecting) {
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
            observer.disconnect();
        };
    });
</script>

<div bind:this={sentinel} class="sentinel"></div>

<style>
    .sentinel {
        height: 1px;
    }
</style>
