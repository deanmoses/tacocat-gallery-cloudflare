import type { Config } from 'prettier';

// Same settings as tacocat-gallery-sveltekit, so the two read alike when they merge.
const config: Config = {
    semi: true,
    trailingComma: 'all',
    singleQuote: true,
    printWidth: 120,
    proseWrap: 'preserve',
    tabWidth: 4,
};

export default config;
