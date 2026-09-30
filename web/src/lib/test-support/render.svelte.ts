import { type Component, flushSync, mount, unmount } from 'svelte';
import { onTestFinished } from 'vitest';

export interface Rendered<Props> {
    /** Changes the mounted component's props, as a parent re-rendering it would. */
    rerender: (props: Partial<Props>) => void;
}

/**
 * Mounts a component into the test page, removed again when the test finishes. Query it with `page` from
 * `vitest/browser`. Written here rather than taken from vitest-browser-svelte, whose peer range accepts Vitest 4, so npm
 * hoists it to the repo root beside the Worker's Vitest 4 and its types lose the locators.
 */
export function render<Props extends Record<string, unknown>>(
    component: Component<Props>,
    props: Props,
): Rendered<Props> {
    const target = document.createElement('div');
    document.body.append(target);
    // Read through to raw state, so a rerender reaches the component the way a parent's changed props would, and a
    // value arrives as the object the test gave rather than a deep proxy of it, which a component that looks something
    // up by the object itself depends on.
    let current = $state.raw(props);
    const passed = new Proxy(props, {
        get: (_initial, key): unknown => Reflect.get(current, key),
        has: (_initial, key): boolean => Reflect.has(current, key),
        ownKeys: (): (string | symbol)[] => Reflect.ownKeys(current),
        getOwnPropertyDescriptor: (_initial, key): PropertyDescriptor | undefined =>
            Reflect.getOwnPropertyDescriptor(current, key),
    });
    const instance = mount(component, { target, props: passed });
    // mount() leaves effects pending, such as the title <svelte:head> sets, until the next microtask. Flushed here, a
    // plain expect() right after render sees what the component does on its first render.
    flushSync();
    onTestFinished(async () => {
        await unmount(instance);
        target.remove();
    });
    return {
        rerender: (next): void => {
            current = { ...current, ...next };
            flushSync();
        },
    };
}
