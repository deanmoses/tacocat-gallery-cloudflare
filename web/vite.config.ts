import { sveltekit } from '@sveltejs/kit/vite';
import { playwright } from '@vitest/browser-playwright';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * The media URLs a rendered <img> or <video> asks for are the Worker's, so nothing serves them under test. SvelteKit's
 * dev fallback would render them on the server instead, loading its SSR runtime as Vitest shuts down and printing
 * "transport was disconnected". Listed before sveltekit() so this runs ahead of that fallback.
 */
function notFoundUnderTest(): Plugin {
    return {
        name: 'not-found-under-test',
        apply: (_config, { mode }) => mode === 'test',
        configureServer(server) {
            return () => {
                server.middlewares.use((_request, response) => {
                    response.statusCode = 404;
                    response.end();
                });
            };
        },
    };
}

export default defineConfig({
    plugins: [notFoundUnderTest(), sveltekit()],
    test: {
        include: ['src/**/*.test.ts'],
        // Undoes vi.spyOn() after each test, so no test needs an afterEach hook for it.
        restoreMocks: true,
        // Undoes vi.stubGlobal() after each test in the same way.
        unstubGlobals: true,
        // Files and the tests in them run in a random order, so a test that passes only because of what ran before it
        // fails. Each run prints its seed; rerun a failure in the same order with --sequence.seed=<seed>.
        sequence: { shuffle: true },
        // A test that asserts nothing fails.
        expect: { requireAssertions: true },
        // expect.element retries until the test's own deadline, which in browser mode defaults to 15s, so a wrong
        // assertion would sit for 15s before failing. Nothing here loads from anywhere slower than memory.
        testTimeout: 3000,
        // Components run in a real browser, where effects run and the DOM is the real one.
        browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
            // The default is a phone's width. A test about what a phone shows sets its own viewport and says so.
            viewport: { width: 1280, height: 800 },
        },
        // For finding what no test reaches, not a gate, so no thresholds. Istanbul rather than V8 to match api/, whose
        // tests run in workerd, where V8 coverage is not supported.
        coverage: {
            provider: 'istanbul',
            // Globbed from the source tree, so a file no test imports shows at 0% instead of not at all.
            include: ['src/**/*.{ts,svelte}'],
            exclude: ['src/**/*.test.ts', 'src/lib/test-support/**', 'src/**/*.d.ts'],
            // Set explicitly because Vitest changes its defaults when it detects an AI agent running it. skipFull lists
            // only the files with something uncovered.
            reporter: [['text', { skipFull: true }], 'text-summary', 'html'],
        },
    },
});
