import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Tests run inside workerd against local D1, R2 and Queue bindings built from wrangler.jsonc, with the migrations in
// TEST_MIGRATIONS for test/setup.ts to apply.
export default defineConfig({
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
    test: {
        // The Worker's tests only; web/ runs its own under its own Vitest.
        include: ['test/**/*.test.ts'],
        setupFiles: ['./test/setup.ts'],
        // Undoes vi.spyOn() after each test, so no test needs an afterEach hook for it.
        restoreMocks: true,
        // Files and the tests in them run in a random order, so a test that passes only because of what ran before it
        // fails. Each run prints its seed; rerun a failure in the same order with --sequence.seed=<seed>.
        sequence: { shuffle: true },
    },
});
