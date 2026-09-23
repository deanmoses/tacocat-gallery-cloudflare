import path from 'node:path';
import comments from '@eslint-community/eslint-plugin-eslint-comments';
import js from '@eslint/js';
import json from '@eslint/json';
import vitest from '@vitest/eslint-plugin';
import prettier from 'eslint-config-prettier';
import node from 'eslint-plugin-n';
import playwright from 'eslint-plugin-playwright';
import regexp from 'eslint-plugin-regexp';
import svelte from 'eslint-plugin-svelte';
import unicorn from 'eslint-plugin-unicorn';
import type { Linter } from 'eslint';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './web/svelte.config.js';

// Every plugin's recommended rules are on, so a rule its maintainers add to them arrives with the upgrade. Rules beyond
// that come on only by name (PICKED_RULES, UNICORN_BUG_RULES, the tests block), because the rest of each plugin's
// `all` preset is mostly house style. Plugins whose every rule is about their own subject (svelte, regexp, json,
// eslint-comments) run all of them. Rules come off only in the "turned off" block, each with the reason.

const CODE = ['**/*.ts', '**/*.mjs', '**/*.js', '**/*.svelte'];
// Components, and modules whose `.svelte.` infix lets them use runes.
const SVELTE = ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'];

/** Core and typescript-eslint rules beyond their recommended sets. */
const PICKED_RULES: Record<string, 'error'> = Object.fromEntries(
    [
        // Bugs the type checker cannot see
        'array-callback-return',
        'default-case-last',
        'eqeqeq',
        'guard-for-in',
        'no-caller',
        'no-constructor-return',
        'no-eval',
        'no-extend-native',
        'no-implicit-coercion',
        'no-labels',
        'no-lone-blocks',
        'no-multi-assign',
        'no-new',
        'no-new-func',
        'no-new-wrappers',
        'no-param-reassign',
        'no-promise-executor-return',
        'no-proto',
        'no-return-assign',
        'no-script-url',
        'no-self-compare',
        'no-sequences',
        'no-template-curly-in-string',
        'no-unmodified-loop-condition',
        'no-unreachable-loop',
        'radix',
        'require-atomic-updates',
        'symbol-description',
        '@typescript-eslint/no-unsafe-type-assertion',
        '@typescript-eslint/strict-boolean-expressions',
        '@typescript-eslint/strict-void-return',
        '@typescript-eslint/switch-exhaustiveness-check',
        '@typescript-eslint/require-array-sort-compare',
        '@typescript-eslint/promise-function-async',
        '@typescript-eslint/consistent-return',
        '@typescript-eslint/default-param-last',
        '@typescript-eslint/no-loop-func',
        '@typescript-eslint/no-shadow',

        // Modern equivalents and leftovers, all fixed automatically
        'arrow-body-style',
        'logical-assignment-operators',
        'no-else-return',
        'no-lonely-if',
        'no-nested-ternary',
        'no-object-constructor',
        'no-undef-init',
        'no-unneeded-ternary',
        'no-useless-call',
        'no-useless-computed-key',
        'no-useless-concat',
        'no-useless-rename',
        'no-useless-return',
        'object-shorthand',
        'operator-assignment',
        'prefer-arrow-callback',
        'prefer-exponentiation-operator',
        'prefer-object-has-own',
        'prefer-object-spread',
        'prefer-regex-literals',
        'prefer-template',
        'yoda',

        // TypeScript house style: imports that erase cleanly, and signatures a reader can see
        '@typescript-eslint/consistent-type-exports',
        '@typescript-eslint/consistent-type-imports',
        '@typescript-eslint/explicit-function-return-type',
        '@typescript-eslint/init-declarations',
        '@typescript-eslint/method-signature-style',
        '@typescript-eslint/no-import-type-side-effects',
        '@typescript-eslint/no-unnecessary-qualifier',
        '@typescript-eslint/no-useless-empty-export',
        '@typescript-eslint/parameter-properties',
        '@typescript-eslint/prefer-enum-initializers',
        '@typescript-eslint/prefer-readonly',
    ].map((rule) => [rule, 'error']),
);

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
 * The presets with every rule they set to warn raised to error. Some presets warn, and a warning shows yellow in
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

/** A group of imports a layer of the web app may not make, for `no-restricted-imports`. */
interface Forbidden {
    group: string[];
    message: string;
}

const WORKER_CODE: Forbidden[] = [
    {
        group: ['tacocat-gallery-api', 'tacocat-gallery-api/*', '**/api/src', '**/api/src/**'],
        message: 'Put the shape in shared/ and have the Worker map to it.',
    },
    {
        group: ['drizzle-orm', 'drizzle-orm/*'],
        message: 'Database types stay in the Worker; put the response shape in shared/.',
    },
];
const STORES: Forbidden = {
    group: ['$lib/stores', '$lib/stores/*', '**/stores/*'],
    message: 'Read state in a page or an admin component and pass it down as props.',
};
const COMPONENTS: Forbidden = {
    group: ['$lib/components/*', '**/components/*'],
    message: 'Components are composed by pages; nothing beneath them imports one.',
};
const SVELTEKIT_RUNTIME: Forbidden = {
    group: ['$app/*'],
    message: 'Models are plain data, usable outside the app.',
};
const TEST_SUPPORT: Forbidden = {
    group: ['$lib/test-support/*', '**/test-support/*'],
    message: 'Test support is for tests.',
};

const WEB_TESTS = ['web/src/**/*.test.ts', 'web/src/lib/test-support/**'];

/**
 * The imports `files` may not make: the Worker's code, which no part of the app sees, test support, and what the
 * layer forbids. Tests are exempt from the layers and get a block of their own. ESLint takes the last block that
 * matches a file for a rule's whole setting, so each file has to land in exactly one of these.
 */
function webLayer(name: string, files: string[], forbidden: Forbidden[], ignores: string[] = []): Linter.Config {
    return {
        name,
        files,
        ignores: [...WEB_TESTS, ...ignores],
        rules: { 'no-restricted-imports': ['error', { patterns: [...WORKER_CODE, TEST_SUPPORT, ...forbidden] }] },
    };
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
        extends: asErrors(
            js.configs.recommended,
            ts.configs.strictTypeChecked,
            ts.configs.stylisticTypeChecked,
            unicorn.configs.unopinionated,
            regexp.configs.all,
        ),
        plugins: { '@eslint-community/eslint-comments': comments },
        rules: {
            // No `all` preset for eslint-comments; no-use and no-restricted-disable are lists to fill in, not checks.
            ...allRules('@eslint-community/eslint-comments', comments, ['no-use', 'no-restricted-disable']),
            ...PICKED_RULES,
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
            'e2e/**/*.ts',
            'web/*.ts',
            'web/*.js',
            'shared/*.ts',
        ],
        extends: asErrors(node.configs['flat/recommended']),
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
    // The web app sees the Worker only through its HTTP responses, whose shapes live in shared/. A table's row type
    // reaching it would tie the pages to column names the Worker is free to change.
    webLayer('web imports no worker code', ['web/src/**/*'], []),
    // The app's layers, which its docs describe and this holds to. Models are data with no fetching or persistence;
    // components under site/ are composed by pages and know nothing of state, apart from the admin ones; utils sit
    // under everything; and stores know nothing of components.
    webLayer('web models are pure data', ['web/src/lib/models/**/*'], [STORES, COMPONENTS, SVELTEKIT_RUNTIME]),
    webLayer(
        'web site components are data-agnostic',
        ['web/src/lib/components/site/**/*'],
        [STORES],
        ['web/src/lib/components/site/admin/**'],
    ),
    webLayer('web utils sit under the rest', ['web/src/lib/utils/**/*'], [STORES, COMPONENTS]),
    webLayer('web stores know no components', ['web/src/lib/stores/**/*'], [COMPONENTS]),
    {
        name: 'web tests import what they test',
        files: WEB_TESTS,
        rules: { 'no-restricted-imports': ['error', { patterns: WORKER_CODE }] },
    },
    {
        name: 'worker imports no web code',
        files: ['api/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['tacocat-gallery-web', 'tacocat-gallery-web/*', '**/web/src', '**/web/src/**'],
                            message: 'Move what both sides need into shared/.',
                        },
                    ],
                },
            ],
        },
    },
    {
        // Runs in both the Worker and the browser, so anything tied to one of them, Node included, breaks the other.
        name: 'shared imports only what runs everywhere',
        files: ['shared/src/**/*'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            regex: String.raw`^(?!\.{1,2}/|valibot$|vitest$)`,
                            message: 'shared/ runs in the Worker and the browser alike; keep it to valibot.',
                        },
                        {
                            group: ['**/api/**', '**/web/**'],
                            message: 'shared/ is what the Worker and the web app both import; it imports neither.',
                        },
                    ],
                },
            ],
        },
    },
    {
        name: 'tests',
        files: ['api/test/**/*.ts', 'web/src/**/*.test.ts', 'shared/src/**/*.test.ts'],
        // The recommended set plus the rules below, the same as tacocat-gallery-sveltekit's. Vitest's `all` preset is
        // mostly test-structure opinion, such as banning beforeAll and afterEach outright.
        extends: asErrors(vitest.configs.recommended),
        // Lets prefer-describe-function-title resolve a describe title through the type checker.
        settings: { vitest: { typecheck: true } },
        rules: {
            // Weak assertions that pass when they shouldn't
            'vitest/require-to-throw-message': 'error',
            'vitest/prefer-called-with': 'error',
            'vitest/no-test-return-statement': 'error',
            'vitest/no-conditional-in-test': 'error',

            // Vitest runtime errors, caught at lint time instead
            'vitest/hoisted-apis-on-top': 'error',
            'vitest/require-awaited-expect-poll': 'error',

            // Mocking correctness
            'vitest/prefer-spy-on': 'error',
            'vitest/prefer-vi-mocked': 'error',
            'vitest/prefer-mock-promise-shorthand': 'error',
            'vitest/prefer-mock-return-shorthand': 'error',
            'vitest/require-mock-type-parameters': 'error',
            'vitest/prefer-import-in-mock': 'error',
            'vitest/prefer-called-once': 'error',
            'vitest/prefer-expect-resolves': 'error',
            'vitest/no-duplicate-hooks': 'error',

            // Matchers that produce a useful diff on failure
            'vitest/prefer-equality-matcher': 'error',
            'vitest/prefer-comparison-matcher': 'error',
            'vitest/prefer-to-be': 'error',
            'vitest/prefer-to-contain': 'error',
            'vitest/prefer-to-have-length': 'error',
            'vitest/prefer-strict-equal': 'error',
            'vitest/prefer-strict-boolean-matchers': 'error',
            'vitest/prefer-expect-type-of': 'error',

            // Typos and leftovers
            'vitest/no-alias-methods': 'error',
            'vitest/no-test-prefixes': 'error',
            'vitest/prefer-todo': 'error',

            // Naming and imports: globals are off, so a bare `describe` would be undefined at runtime.
            'vitest/consistent-test-it': 'error',
            'vitest/consistent-test-filename': 'error',
            'vitest/prefer-describe-function-title': 'error',
            'vitest/prefer-importing-vitest-globals': 'error',
            'vitest/consistent-vitest-vi': 'error',

            // Structure: no conditionally defined tests, no callback-style async, hooks first and in lifecycle order.
            'vitest/no-conditional-tests': 'error',
            'vitest/no-done-callback': 'error',
            'vitest/prefer-hooks-on-top': 'error',
            'vitest/prefer-hooks-in-order': 'error',
            'vitest/max-nested-describe': 'error',
            'vitest/prefer-each': 'error',
            'vitest/consistent-each-for': 'error',
            'vitest/require-hook': 'error',
            'vitest/require-top-level-describe': 'error',
            'vitest/padding-around-all': 'error',

            // Snapshots small enough to review, and named when a test takes more than one.
            'vitest/no-large-snapshots': 'error',
            'vitest/prefer-snapshot-hint': 'error',

            // The vitest variant also understands `expect(obj.method)`.
            '@typescript-eslint/unbound-method': 'off',
            'vitest/unbound-method': 'error',
            // Asymmetric matchers such as expect.any(String) are typed any, and an expected object is where they belong.
            '@typescript-eslint/no-unsafe-assignment': 'off',
            // A one-line callback in a table of cases shows its type in its body; named functions still declare theirs.
            '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }],
        },
    },
    {
        name: 'e2e tests',
        files: ['e2e/**/*.ts'],
        ignores: ['e2e/server.ts', 'e2e/playwright.config.ts'],
        // The recommended set plus the rules below, the same as tacocat-gallery-sveltekit's.
        extends: asErrors(playwright.configs['flat/recommended']),
        rules: {
            // Weak assertions that pass when they shouldn't
            'playwright/require-to-throw-message': 'error',
            'playwright/require-to-pass-timeout': 'error',
            'playwright/no-restricted-matchers': [
                'error',
                {
                    toBeFalsy: 'Assert the actual expected state, e.g. toBeHidden() or toBe(false).',
                    toBeTruthy: 'Assert the actual expected state, e.g. toBeVisible() or toBe(true).',
                },
            ],

            // Matchers that produce a useful diff on failure
            'playwright/prefer-comparison-matcher': 'error',
            'playwright/prefer-equality-matcher': 'error',
            'playwright/prefer-strict-equal': 'error',
            'playwright/prefer-to-be': 'error',
            'playwright/prefer-to-contain': 'error',

            // Structure, as in the vitest block
            'playwright/no-commented-out-tests': 'error',
            'playwright/require-top-level-describe': 'error',
            'playwright/require-hook': 'error',

            // Locators a user could perceive, roles and names first, so a restyle cannot break a test. getByTitle reads
            // a tooltip that touch screens never show.
            'playwright/prefer-native-locators': 'error',
            'playwright/no-nth-methods': 'error',
            'playwright/no-get-by-title': 'error',
            'playwright/no-raw-locators': 'error',
        },
    },
    {
        name: 'test setup',
        files: ['api/test/setup.ts'],
        rules: {
            // Hooks here sit at the top level so that they run around every test in every file.
            'vitest/require-top-level-describe': 'off',
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
        name: 'house style',
        files: CODE,
        rules: {
            // One declaration per statement, as in typescript-eslint's own code.
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
            // A number prints the same way everywhere, so it needs no String(). The strict preset's other refusals
            // stand: null, undefined, booleans and objects in a template string are usually a bug.
            '@typescript-eslint/restrict-template-expressions': [
                'error',
                {
                    allowAny: false,
                    allowBoolean: false,
                    allowNever: false,
                    allowNullish: false,
                    allowNumber: true,
                    allowRegExp: false,
                },
            ],
            // Property names are API: `q` in a search response, `x` and `y` in a JWK. `_` names a parameter that is
            // there only to reach the next one.
            'id-length': ['error', { properties: 'never', exceptions: ['_'] }],
            // Keeps member order inside one import sorted; the order of import lines is left alone.
            'sort-imports': ['error', { ignoreDeclarationSort: true }],
            '@typescript-eslint/naming-convention': [
                'error',
                { selector: 'default', format: ['camelCase'] },
                { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
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
            // With promise-function-async, every function that returns a promise is async, so one with nothing to
            // await is deliberate.
            '@typescript-eslint/require-await': 'off',
            // A copy of @typescript-eslint/require-array-sort-compare, which is on, without type information: it cannot
            // tell a string array, whose default sort is the one wanted, from a number array.
            'unicorn/require-array-sort-compare': 'off',
            // Deprecated in favour of no-navigation-without-resolve, which is on. resolve() already applies the base path,
            // and this rule cannot see that, so the two cannot both pass.
            'svelte/no-navigation-without-base': 'off',
            // {@const} is how a value derived inside an {#each} block gets a name; the rule is the preset's taste, not a check.
            'svelte/no-at-const-tags': 'off',
        },
    },

    // Last, so formatting is Prettier's alone.
    { files: CODE, extends: [prettier] },
    { files: SVELTE, extends: [svelte.configs['flat/prettier']] },
);
