import adapter from '@sveltejs/adapter-static';

/**
 * Runes mode for every component of the app. A dependency keeps the compiler's default, which reads the mode off each
 * component, since @zerodevx/svelte-toast ships Svelte 4 source and svelte-easy-crop is written with runes; forcing
 * either mode on both breaks one of them at run time.
 * @param {{ filename: string }} file
 * @returns {boolean | undefined}
 */
function inTheApp({ filename }) {
    const inDependency = filename.includes('/node_modules/') || filename.includes('\\node_modules\\');
    return !inDependency || undefined;
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
    compilerOptions: {
        // A component that uses no runes at all -- most of the icons, several
        // layouts -- is otherwise compiled in the mode-ambiguous default, where
        // `export let` and `$:` still work. Forcing runes mode makes legacy
        // syntax a compile error instead of a silent per-component mode switch.
        // Removable in Svelte 6, once runes mode is the only mode.
        runes: inTheApp,
    },

    kit: {
        adapter: adapter({
            fallback: 'index.html',
        }),
    },
};

export default config;
