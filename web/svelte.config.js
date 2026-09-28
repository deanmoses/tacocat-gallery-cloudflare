import adapter from '@sveltejs/adapter-static';
import path from 'node:path';
import { buildVersion } from './build-version.ts';

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

const REPO = path.resolve(import.meta.dirname, '..');

/** @type {import('@sveltejs/kit').Config} */
const config = {
    compilerOptions: {
        // A component that uses no runes at all -- most of the icons, several
        // layouts -- is otherwise compiled in the mode-ambiguous default, where
        // `export let` and `$:` still work. Forcing runes mode makes legacy
        // syntax a compile error instead of a silent per-component mode switch.
        // Removable in Svelte 6, once runes mode is the only mode.
        runes: inTheApp,
        // Svelte hashes a component's path, relative to this, into its scoped CSS class, and defaults it to the
        // directory the build started in. A dependency sits in the repo root's node_modules, outside web/, so relative
        // to the repo is the one base that gives every component the same class, and every chunk carrying one the
        // same name, from any checkout and any directory.
        rootDir: REPO,
    },

    kit: {
        adapter: adapter({
            fallback: 'index.html',
        }),
        version: { name: buildVersion(REPO) },
    },
};

export default config;
