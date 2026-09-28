import path from 'node:path';
import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';
import config from '../svelte.config.js';

const REPO = path.resolve(import.meta.dirname, '../..');
const ELSEWHERE = '/home/runner/work/gallery/gallery';
const COMPONENT = '<p>toast</p>\n<style>p { color: red; }</style>';

function scopedClass(filename: string, rootDir: string): string {
    return /svelte-[0-9a-z]+/v.exec(compile(COMPONENT, { filename, rootDir }).js.code)?.[0] ?? '';
}

describe('the Svelte compiler options', () => {
    it.each([
        { name: "a dependency's", file: 'node_modules/@zerodevx/svelte-toast/dist/Toast.svelte' },
        { name: "the app's", file: 'web/src/lib/Header.svelte' },
    ])('give $name component the class it gets in a checkout anywhere else', ({ file }) => {
        // Where the config sets none, Svelte uses the directory the build started in.
        const here = scopedClass(path.join(REPO, file), config.compilerOptions?.rootDir ?? process.cwd());

        expect(here).toMatch(/^svelte-/v);
        expect(here).toBe(scopedClass(path.join(ELSEWHERE, file), ELSEWHERE));
    });
});
