import path from 'node:path';
import comments from '@eslint-community/eslint-plugin-eslint-comments';
import js from '@eslint/js';
import json from '@eslint/json';
import vitest from '@vitest/eslint-plugin';
import prettier from 'eslint-config-prettier';
import node from 'eslint-plugin-n';
import regexp from 'eslint-plugin-regexp';
import unicorn from 'eslint-plugin-unicorn';
import type { Linter } from 'eslint';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

// Every rule of every plugin is on, via each one's `all` preset, so a rule added upstream is enforced as soon as the
// dependency is upgraded. Rules come off only in the "reconfigured" and "turned off" blocks, each with the reason.

const CODE = ['**/*.ts', '**/*.mjs', '**/*.js'];

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
    { ignores: ['worker-configuration.d.ts', 'infra/', 'migrations/meta/', 'package-lock.json'] },
    {
        linterOptions: {
            reportUnusedDisableDirectives: 'error',
            reportUnusedInlineConfigs: 'error',
        },
    },

    {
        name: 'code',
        files: CODE,
        extends: asErrors(js.configs.all, ts.configs.all, unicorn.configs.all, regexp.configs.all),
        plugins: { '@eslint-community/eslint-comments': comments },
        // No `all` preset for eslint-comments; no-use and no-restricted-disable are lists to fill in, not checks.
        rules: allRules('@eslint-community/eslint-comments', comments, ['no-use', 'no-restricted-disable']),
        languageOptions: {
            parserOptions: {
                // Each file is checked against its nearest tsconfig.json: the Worker, its tests, or the Node side.
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },

    {
        name: 'node',
        files: ['*.ts', 'scripts/**/*.ts', 'transcoder/**/*.ts'],
        extends: asErrors(node.configs['flat/all']),
        languageOptions: { globals: globals.node },
        rules: {
            // Uint8Array#toBase64 and fromBase64 arrived in Node 25; .nvmrc pins 24, so Node code uses Buffer.
            'unicorn/prefer-uint8array-base64': 'off',
        },
    },
    {
        name: 'worker',
        files: ['src/**/*.ts', 'test/**/*.ts'],
        languageOptions: { globals: globals.serviceworker },
    },
    {
        name: 'tests',
        files: ['test/**/*.ts'],
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
            // `Env`, `env` and `ctx` are what Cloudflare's docs and types call the bindings and execution context.
            'unicorn/name-replacements': [
                'error',
                { allowList: Object.fromEntries(['Env', 'env', 'ctx'].map((name) => [name, true])) },
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
            // SQL NULL and JSON null are part of the data model; D1 and Drizzle return them.
            'unicorn/no-null': 'off',
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
            // Temporal is not in workerd (checked 2026-09-22 with compatibility_date 2026-09-01) or Node 24.
            'unicorn/prefer-temporal': 'off',
            // With promise-function-async, every function that returns a promise is async, so one with nothing to
            // await is deliberate.
            '@typescript-eslint/require-await': 'off',
            // Superseded by @typescript-eslint/naming-convention, which is configured above.
            camelcase: 'off',
            // House style is a one-line /** doc */ for one-sentence docs and the usual ` * ` prefix when longer;
            // These two rules each forbid one of those.
            'unicorn/single-line-block-comment-style': 'off',
            'unicorn/no-asterisk-prefix-in-documentation-comments': 'off',
            // Wants each multi-line // comment joined into one line of any length. House style wraps comments at 120
            // columns like the code, and Prettier never re-wraps them.
            'unicorn/no-manually-wrapped-comments': 'off',
            // Contradicts arrow-body-style whenever Prettier breaks a returned object over several lines;
            // arrow-body-style stays.
            'unicorn/consistent-arrow-return-style': 'off',
            // Forces "Ffmpeg" for a tool spelled ffmpeg; a comment that starts with a name keeps the name's case.
            'capitalized-comments': 'off',
            // Splits `new Date().toISOString()` into two statements for nothing.
            'unicorn/no-unreadable-new-expression': 'off',
            // Fires on every Drizzle query: `where(and(inArray(...), gt(...)))` is the query builder's idiom.
            'unicorn/max-nested-calls': 'off',
        },
    },

    // Last, so formatting is Prettier's alone.
    { files: CODE, extends: [prettier] },
);
