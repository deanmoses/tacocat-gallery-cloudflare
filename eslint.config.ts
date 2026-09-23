import path from 'node:path';
import comments from '@eslint-community/eslint-plugin-eslint-comments';
import js from '@eslint/js';
import json from '@eslint/json';
import vitest from '@vitest/eslint-plugin';
import prettier from 'eslint-config-prettier';
import node from 'eslint-plugin-n';
import regexp from 'eslint-plugin-regexp';
import svelte from 'eslint-plugin-svelte';
import unicorn from 'eslint-plugin-unicorn';
import type { Linter } from 'eslint';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './web/svelte.config.js';

// Every rule of every plugin is on, via each one's `all` preset, so a rule added upstream is enforced as soon as the
// dependency is upgraded, except unicorn (see UNICORN_BUG_RULES). Rules come off only in the "reconfigured" and
// "turned off" blocks, each with the reason.

const CODE = ['**/*.ts', '**/*.mjs', '**/*.js', '**/*.svelte'];
// Components, and modules whose `.svelte.` infix lets them use runes.
const SVELTE = ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'];

/**
 * unicorn's rules that catch bugs but sit outside its `unopinionated` preset, which the code uses. Its other presets
 * add house-style rules, many of which fight Svelte and SvelteKit conventions.
 */
const UNICORN_BUG_RULES: Record<string, 'error'> = Object.fromEntries(
    [
        'no-computed-property-existence-check',
        'no-duplicate-if-branches',
        'no-duplicate-set-values',
        'no-incorrect-query-selector',
        'no-incorrect-template-string-interpolation',
        'no-late-current-target-access',
        'no-late-event-control',
        'no-loop-iterable-mutation',
        'no-mismatched-map-key',
        'no-object-methods-with-collections',
        'no-optional-chaining-on-undeclared-variable',
        'no-return-array-push',
        'no-selector-as-dom-name',
        'no-this-outside-of-class',
        'no-uncalled-method',
        'no-undeclared-class-members',
        'no-unsafe-property-key',
        'no-unsafe-string-replacement',
        'prefer-https',
    ].map((rule) => [`unicorn/${rule}`, 'error']),
);

/** Every rule a plugin exports, for plugins with no `all` preset, minus the ones named in `except`. */
function allRules(
    prefix: string,
    plugin: { rules?: Record<string, unknown> },
    except: string[] = [],
): Record<string, 'error'> {
    return Object.fromEntries(
        Object.keys(plugin.rules ?? {})
            .filter((rule) => !except.includes(rule))
            .map((rule) => [`${prefix}/${rule}`, 'error']),
    );
}

/**
 * The presets with every rule they set to warn raised to error. Some `all` presets warn, and a warning shows yellow in
 * the editor and lets a bare `eslint` run pass, where scripts/lint.sh's --max-warnings 0 fails it.
 */
function asErrors(...presets: (Linter.Config | Linter.Config[])[]): Linter.Config[] {
    return presets.flat().map((preset) => ({
        ...preset,
        rules: Object.fromEntries(Object.entries(preset.rules ?? {}).map(([rule, entry]) => [rule, raise(entry)])),
    }));
}

function raise(entry: Linter.RuleEntry | undefined): Linter.RuleEntry | undefined {
    if (entry === 'warn' || entry === 1) {
        return 'error';
    }
    if (!Array.isArray(entry) || (entry[0] !== 'warn' && entry[0] !== 1)) {
        return entry;
    }
    const options: unknown[] = entry.slice(1);
    return ['error', ...options];
}

export default defineConfig(
    includeIgnoreFile(path.resolve(import.meta.dirname, '.gitignore')),
    // Generated: Wrangler's types and drizzle-kit's migration snapshots.
    { ignores: ['api/worker-configuration.d.ts', 'infra/', 'api/migrations/meta/', 'package-lock.json'] },
    {
        linterOptions: {
            reportUnusedDisableDirectives: 'error',
            reportUnusedInlineConfigs: 'error',
        },
    },

    {
        name: 'code',
        files: CODE,
        extends: asErrors(js.configs.all, ts.configs.all, unicorn.configs.unopinionated, regexp.configs.all),
        plugins: { '@eslint-community/eslint-comments': comments },
        rules: {
            // No `all` preset for eslint-comments; no-use and no-restricted-disable are lists to fill in, not checks.
            ...allRules('@eslint-community/eslint-comments', comments, ['no-use', 'no-restricted-disable']),
            ...UNICORN_BUG_RULES,
        },
        languageOptions: {
            parserOptions: {
                // Each file is checked against its nearest tsconfig.json: the Worker, its tests, or the Node side.
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },

    {
        name: 'svelte',
        files: SVELTE,
        extends: asErrors(svelte.configs['flat/all']),
        languageOptions: {
            parserOptions: {
                // The <script lang="ts"> inside a component goes to the TypeScript parser, with the type information
                // the `code` block sets up.
                parser: ts.parser,
                extraFileExtensions: ['.svelte'],
                svelteConfig,
            },
        },
        rules: {
            // The preset's default wants no `lang` at all; every script here is TypeScript.
            'svelte/block-lang': ['error', { script: 'ts' }],
        },
    },

    {
        name: 'node',
        files: [
            '*.ts',
            'scripts/**/*.ts',
            'api/*.ts',
            'api/scripts/**/*.ts',
            'api/transcoder/**/*.ts',
            'api/test/stack/**/*.ts',
            'web/*.ts',
            'web/*.js',
        ],
        extends: asErrors(node.configs['flat/all']),
        languageOptions: { globals: globals.node },
    },
    {
        name: 'worker',
        files: ['api/src/**/*.ts', 'api/test/**/*.ts'],
        ignores: ['api/test/stack/**'],
        languageOptions: { globals: globals.serviceworker },
    },
    {
        name: 'web',
        files: ['web/src/**/*'],
        languageOptions: { globals: globals.browser },
    },
    {
        name: 'tests',
        files: ['api/test/**/*.ts', 'web/src/**/*.test.ts'],
        extends: asErrors(vitest.configs.all),
        rules: {
            // For tests whose assertions sit in callbacks that might never run. Every test here awaits its work,
            // and no-floating-promises catches one that doesn't.
            'vitest/prefer-expect-assertions': 'off',
            // A cap of five pushes assertions into arrays, which makes a failure message say less, not more.
            'vitest/max-expects': 'off',
        },
    },

    {
        name: 'json',
        files: ['**/*.json', '**/*.jsonc'],
        plugins: { json },
        language: 'json/json',
        rules: {
            ...allRules('json', json),
            // Key order is the reader's: name and scripts first in package.json, compilerOptions before include.
            'json/sort-keys': 'off',
        },
    },
    {
        // JSON with comments and trailing commas: tsconfigs, wrangler.jsonc, the linters' own configs and VS Code's.
        name: 'jsonc',
        files: ['**/*.jsonc', '**/tsconfig*.json', '.vscode/*.json'],
        language: 'json/jsonc',
        languageOptions: { allowTrailingCommas: true },
    },

    {
        name: 'reconfigured',
        files: CODE,
        rules: {
            // `all` asks for one declaration per scope; this codebase, like typescript-eslint's own, does the opposite.
            'one-var': ['error', 'never'],
            // Function declarations, with arrows for callbacks and one-liners.
            'func-style': ['error', 'declaration', { allowArrowFunctions: true }],
            // Files read top down: the entry point first, the helpers it calls below. Hoisted functions and constants
            // Read inside functions are safe; a use before definition in the same scope is still an error.
            '@typescript-eslint/no-use-before-define': [
                'error',
                { functions: false, classes: true, variables: false, enums: true, typedefs: false },
            ],
            // `void promise;` marks a promise deliberately left running, which is how no-floating-promises is
            // satisfied; every other use of void stays an error.
            'no-void': ['error', { allowAsStatement: true }],
            // Property names are API: `q` in a search response, `x` and `y` in a JWK.
            'id-length': ['error', { properties: 'never' }],
            // Keeps member order inside one import sorted; the order of import lines is left alone.
            'sort-imports': ['error', { ignoreDeclarationSort: true }],
            '@typescript-eslint/naming-convention': [
                'error',
                { selector: 'default', format: ['camelCase'] },
                { selector: 'import', format: ['camelCase', 'PascalCase'] },
                // Module constants in UPPER_CASE; destructured classes in PascalCase.
                { selector: 'variable', modifiers: ['const'], format: ['camelCase', 'UPPER_CASE', 'PascalCase'] },
                { selector: 'typeLike', format: ['PascalCase'] },
                // Properties that mirror a format we don't own: Worker bindings and secrets (UPPER_CASE by Cloudflare
                // convention), D1 rows (SQL column names) and ffprobe's JSON (snake_case).
                {
                    selector: ['typeProperty', 'objectLiteralProperty'],
                    format: ['camelCase', 'UPPER_CASE', 'snake_case'],
                },
                // HTTP headers, cookie names and other keys that are someone else's wire format.
                { selector: ['objectLiteralProperty', 'typeProperty'], modifiers: ['requiresQuotes'], format: null },
            ],
        },
    },
    {
        name: 'turned off',
        files: CODE,
        rules: {
            // Status codes, byte sizes and time spans read more clearly inline than as named constants.
            '@typescript-eslint/no-magic-numbers': 'off',
            // Key order carries meaning here: JSON responses, SQL column lists, log fields.
            'sort-keys': 'off',
            // Request, Env, D1Database and the rest of the platform types are mutable, so nearly every parameter fails.
            '@typescript-eslint/prefer-readonly-parameter-types': 'off',
            // `undefined` is how TypeScript spells "absent", and exactOptionalPropertyTypes makes it deliberate.
            'no-undefined': 'off',
            // No-nested-ternary still applies; a single conditional expression is fine.
            'no-ternary': 'off',
            // Console is the logging API: Workers Logs collects it, and scripts print to it.
            'no-console': 'off',
            // Top-level await is standard ESM, and the scripts use it.
            'n/no-top-level-await': 'off',
            // Complexity and max-lines-per-function already bound a function's size.
            'max-statements': 'off',
            // With promise-function-async, every function that returns a promise is async, so one with nothing to
            // await is deliberate.
            '@typescript-eslint/require-await': 'off',
            // Superseded by @typescript-eslint/naming-convention, which is configured above.
            camelcase: 'off',
            // Forces "Ffmpeg" for a tool spelled ffmpeg; a comment that starts with a name keeps the name's case.
            'capitalized-comments': 'off',
        },
    },

    // Last, so formatting is Prettier's alone.
    { files: CODE, extends: [prettier] },
    { files: SVELTE, extends: [svelte.configs['flat/prettier']] },
);
