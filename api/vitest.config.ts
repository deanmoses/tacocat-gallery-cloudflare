import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { TEST_SECRETS } from './test/secrets.ts';

export default defineConfig({
    // Fixtures a test loads with ?inline; Vite knows the image formats but not HEIC.
    assetsInclude: ['**/*.heic'],
    test: {
        // Undoes vi.spyOn() after each test, so no test needs an afterEach hook for it.
        restoreMocks: true,
        // Undoes vi.stubGlobal() after each test in the same way.
        unstubGlobals: true,
        // A test that asserts nothing fails.
        expect: { requireAssertions: true },
        // Files and the tests in them run in a random order, so a test that passes only because of what ran before it
        // fails. Each run prints its seed; rerun a failure in the same order with --sequence.seed=<seed>.
        sequence: { shuffle: true },
        // For finding what no test reaches, not a gate, so no thresholds. Istanbul, since V8 coverage does not work
        // inside workerd. Only the worker project counts: the stack tests reach the Worker through a separate workerd.
        coverage: {
            provider: 'istanbul',
            // Globbed from the source tree, so a file no test imports shows at 0% instead of not at all.
            include: ['src/**/*.ts'],
            // Set explicitly because Vitest changes its defaults when it detects an AI agent running it. skipFull lists
            // only the files with something uncovered.
            reporter: [['text', { skipFull: true }], 'text-summary', 'html'],
        },
        projects: [
            {
                extends: true,
                // Tests run inside workerd against local D1, R2 and Queue bindings built from wrangler.jsonc, with the
                // migrations in TEST_MIGRATIONS for test/setup.ts to apply. They call the Worker directly, so the asset
                // router in front of it is not part of what they see.
                plugins: [
                    cloudflareTest(async () => ({
                        wrangler: { configPath: './wrangler.jsonc' },
                        // Never reach the Cloudflare account from a test.
                        remoteBindings: false,
                        miniflare: {
                            bindings: {
                                TEST_MIGRATIONS: await readD1Migrations('./migrations'),
                                ...TEST_SECRETS,
                                // Uploads are presigned into the bucket, whatever a developer's .dev.vars says; a test
                                // of local uploads passes UPLOADS itself.
                                UPLOADS: 'signed',
                            },
                        },
                    })),
                ],
                // Three tiers, by what a test touches: unit/ only the code under test, db/ D1 through the query
                // functions, integration/ the Worker's fetch, queue and scheduled handlers. Run one with its directory,
                // as in `vitest run test/db`.
                test: {
                    name: 'worker',
                    include: ['test/{unit,db,integration}/*.test.ts'],
                    setupFiles: ['./test/setup.ts'],
                },
            },
            {
                extends: true,
                // Tests run in Node against the whole local stack `wrangler dev` runs, asset router included.
                test: {
                    name: 'stack',
                    include: ['test/stack/*.test.ts'],
                    environment: 'node',
                    globalSetup: ['./test/stack/global-setup.ts'],
                },
            },
        ],
    },
});
