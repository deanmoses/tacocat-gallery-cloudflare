import adapter from '@sveltejs/adapter-static';

/**
 * Runes mode for every component of the app, and legacy mode for a dependency, since @zerodevx/svelte-toast and
 * svelte-easy-crop ship Svelte 4 source.
 * @param {{ filename: string }} file
 * @returns {boolean}
 */
function inTheApp({ filename }) {
    return !filename.includes('/node_modules/') && !filename.includes('\\node_modules\\');
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
