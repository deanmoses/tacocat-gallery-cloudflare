import { sveltekit } from '@sveltejs/kit/vite';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [sveltekit()],
    test: {
        include: ['src/**/*.test.ts'],
        // Undoes vi.spyOn() after each test, so no test needs an afterEach hook for it.
        restoreMocks: true,
        // Files and the tests in them run in a random order, so a test that passes only because of what ran before it
        // fails. Each run prints its seed; rerun a failure in the same order with --sequence.seed=<seed>.
        sequence: { shuffle: true },
        // A test that asserts nothing fails.
        expect: { requireAssertions: true },
        // Components run in a real browser, where effects run and the DOM is the real one.
        browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
        },
    },
});
