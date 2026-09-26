import esx from 'eslint-plugin-es-x';

/**
 * The es-x presets whose every feature the browsers in .browserslistrc lack, by edition. A browser does not implement
 * an edition whole, so the presets are followed by the earlier features the floor still lacks and the later ones it
 * already has: Safari 15.6 lacks ES2018's lookbehind and ES2022's class static blocks, and 15.4 has ES2023's findLast.
 */
const PRESETS = [
    'flat/no-new-in-es2023',
    'flat/no-new-in-es2023-intl-api',
    'flat/no-new-in-es2024',
    'flat/no-new-in-es2025',
    'flat/no-new-in-es2025-intl-api',
    'flat/no-new-in-es2026',
    'flat/no-new-in-es2026-intl-api',
    'flat/no-new-in-esnext',
] as const;
const LACKED = ['es-x/no-regexp-lookbehind-assertions', 'es-x/no-class-static-block'];
const PRESENT = new Set(['es-x/no-array-prototype-findlast-findlastindex', 'es-x/no-hashbang']);

export const BROWSER_FLOOR_RULES: Record<string, 'error'> = Object.fromEntries(
    [...PRESETS.flatMap((preset) => Object.keys(esx.configs[preset].rules ?? {})), ...LACKED]
        .filter((rule) => !PRESENT.has(rule))
        .map((rule) => [rule, 'error']),
);

/**
 * The same, less the rules that need the receiver's type: without one, every `.map()` and `.find()` reads as an
 * iterator helper, and `Iterator` itself is what a library feature-detects before using. For code that has no types.
 */
export const BROWSER_FLOOR_RULES_UNTYPED: Record<string, 'error'> = Object.fromEntries(
    Object.entries(BROWSER_FLOOR_RULES).filter(([rule]) => !rule.includes('iterator')),
);
