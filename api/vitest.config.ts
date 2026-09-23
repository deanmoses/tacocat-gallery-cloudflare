import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Undoes vi.spyOn() after each test, so no test needs an afterEach hook for it.
        restoreMocks: true,
        // Files and the tests in them run in a random order, so a test that passes only because of what ran before it
        // fails. Each run prints its seed; rerun a failure in the same order with --sequence.seed=<seed>.
        sequence: { shuffle: true },
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
                                SESSION_SECRET: 'test-session-secret',
                                R2_ACCESS_KEY_ID: 'test-access-key',
                                R2_SECRET_ACCESS_KEY: 'test-secret-key',
                                GLOBALPING_TOKEN: 'test-globalping-token',
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
