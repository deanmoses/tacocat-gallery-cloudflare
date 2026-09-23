import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
    compilerOptions: {
        // Runes mode for every component, including ones that use no runes, so legacy syntax (`export let`, `$:`) is a
        // compile error rather than a silent switch to the old mode. A dependency that ships Svelte 4 components would
        // need this to become a function that returns undefined for files under node_modules.
        runes: true,
    },
    kit: {
        // A single-page app: every path the build has no file for gets index.html, and the router takes it from there.
        adapter: adapter({ fallback: 'index.html' }),
    },
};

export default config;
