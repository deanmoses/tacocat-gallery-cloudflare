import { type Component, flushSync, mount, unmount } from 'svelte';
import { onTestFinished } from 'vitest';

/**
 * Mounts a component into the test page, removed again when the test finishes. Query it with `page` from
 * `vitest/browser`. Written here rather than taken from vitest-browser-svelte, whose peer range accepts Vitest 4, so npm
 * hoists it to the repo root beside the Worker's Vitest 4 and its types lose the locators.
 */
export function render<Props extends Record<string, unknown>>(component: Component<Props>, props: Props): void {
    const target = document.createElement('div');
    document.body.append(target);
    const instance = mount(component, { target, props });
    // mount() leaves effects pending, such as the title <svelte:head> sets, until the next microtask. Flushed here, a
    // plain expect() right after render sees what the component does on its first render.
    flushSync();
    onTestFinished(async () => {
        await unmount(instance);
        target.remove();
    });
}
