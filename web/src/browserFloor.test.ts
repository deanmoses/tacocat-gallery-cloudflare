import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { browserFloorFindings } from '../vite.config';

const REPO = path.resolve(import.meta.dirname, '../..');

/** What the bundler emits for a regular expression it cannot rewrite, beside a method call, as a built chunk. */
const CHUNK_PAST_THE_FLOOR = String.raw`var a=RegExp('(?<=x)^\d{4}$','v');var b=[1].toSorted();export{a,b};`;
const CHUNK_ON_THE_FLOOR = String.raw`var a=/^\d{4}$/u;var b=[1].sort().at(-1);var c=[1].map((n)=>n).find(Boolean);export{a,b,c};`;

/** The same features as source, each one written the way its autofix would. */
const SOURCE_PAST_THE_FLOOR = [
    'export const a = /^a$/v;',
    'export const b = [1].toSorted();',
    'export const c = new Map<string, number>().values().find((n) => n > 1);',
    'export const d = /(?<=x)y/u;',
    'export class E {',
    '    static {',
    '        console.log(1);',
    '    }',
    '}',
    '',
].join('\n');

describe(browserFloorFindings, () => {
    it('names each feature a chunk uses that the floor lacks', async () => {
        const findings = await browserFloorFindings(CHUNK_PAST_THE_FLOOR, 'chunk.js');

        expect(findings.map((finding) => finding.split(':', 1)[0])).toStrictEqual([
            'es-x/no-regexp-lookbehind-assertions',
            'es-x/no-regexp-v-flag',
            'es-x/no-array-prototype-tosorted',
        ]);
    });

    it('passes a chunk that uses only what the floor has, array methods that share an iterator helper name included', async () => {
        await expect(browserFloorFindings(CHUNK_ON_THE_FLOOR, 'chunk.js')).resolves.toStrictEqual([]);
    });
});

describe('the browser floor lint', () => {
    // The lint loads the repo's whole config and the web app's type information, which takes a few seconds.
    it('reports each feature the floor lacks in a web source file', { timeout: 30_000 }, async () => {
        const eslint = new ESLint({ cwd: REPO });
        const results = await eslint.lintText(SOURCE_PAST_THE_FLOOR, {
            filePath: path.join(REPO, 'web/src/params/year.ts'),
        });
        const rules = results.flatMap((result) => result.messages.map((message) => message.ruleId));

        expect(rules).toStrictEqual(
            expect.arrayContaining([
                'es-x/no-regexp-v-flag',
                'es-x/no-array-prototype-tosorted',
                'es-x/no-iterator-prototype-find',
                'es-x/no-regexp-lookbehind-assertions',
                'es-x/no-class-static-block',
                'compat/compat',
            ]),
        );
    });
});
