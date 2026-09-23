import type { Config } from 'stylelint';

// stylelint-config-standard, plus the rules below that it leaves off. Stylelint has no preset that turns everything on,
// so each addition is a rule that catches a mistake or holds one way of writing something.
const config: Config = {
    extends: ['stylelint-config-standard'],
    overrides: [
        { files: ['**/*.svelte'], customSyntax: 'postcss-html', extends: ['stylelint-config-html/svelte'] },
        {
            // The site's utility classes, such as hidden-sm, have to beat a component's scoped rule, and its rules for
            // Quill's editor follow Quill's markup.
            files: ['web/src/lib/styles/global.css'],
            rules: { 'declaration-no-important': null, 'selector-max-compound-selectors': null },
        },
    ],
    rules: {
        // Svelte's escape hatch out of component scoping.
        'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['global'] }],

        // Mistakes a browser drops without a word.
        'color-no-invalid-hex': true,
        'function-no-unknown': true,
        'unit-no-unknown': true,
        'no-unknown-animations': true,
        'selector-no-deprecated': true,
        'function-url-no-scheme-relative': true,

        // Specificity. Component styles are scoped, so they have no need to outrank anything.
        'declaration-no-important': true,
        'selector-max-id': 0,
        'selector-no-qualifying-type': true,
        'selector-max-compound-selectors': 3,
        'max-nesting-depth': 2,

        // One way to write each. Six hex digits throughout, so the year palettes in the web app read as one table.
        'color-named': 'never',
        'color-hex-length': 'long',
        'font-weight-notation': 'numeric',
    },
};

export default config;
