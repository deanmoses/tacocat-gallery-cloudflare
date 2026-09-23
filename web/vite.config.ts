import { sveltekit } from '@sveltejs/kit/vite';
import { playwright } from '@vitest/browser-playwright';
import type { Plugin, ProxyOptions } from 'vite';
import { defaultExclude, defineConfig } from 'vitest/config';

// The Worker, which `npm run dev --workspace api` serves with the app's build. `vite dev` serves the app itself, with
// hot reloading, and passes the Worker's own routes through to it.
const WORKER = 'http://localhost:8787';
const workerProxy: Record<string, ProxyOptions> = Object.fromEntries(
    ['/api', '/i', '/v', '/raw', '/login', '/invite'].map((path) => [path, { target: WORKER }]),
);

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
        // Undoes vi.spyOn() after each test, so no test needs an afterEach hook for it.
        restoreMocks: true,
        // Undoes vi.stubGlobal() after each test in the same way.
        unstubGlobals: true,
        // Files and the tests in them run in a random order, so a test that passes only because of what ran before it
        // fails. Each run prints its seed; rerun a failure in the same order with --sequence.seed=<seed>.
        sequence: { shuffle: true },
        // A test that asserts nothing fails.
        expect: { requireAssertions: true },
        // Which runtime a test gets is decided by its name: `.svelte.test.ts` compiles runes in the test itself and
        // needs the client build, where $effect runs. Everything else stays in Node, which starts far faster.
        projects: [
            {
                extends: true,
                test: {
                    name: 'node',
                    include: ['src/**/*.test.ts'],
                    // Setting exclude replaces Vitest's default rather than adding to it.
                    exclude: [...defaultExclude, 'src/**/*.svelte.test.ts'],
                    // An IndexedDB, which Node has none of, so idb-keyval itself runs and a test covers what a version
                    // bump would change, and the structured-clone rules that decide what the cache can hold.
                    setupFiles: ['fake-indexeddb/auto', 'src/lib/test-support/setup.ts'],
                },
            },
            {
                extends: true,
                test: {
                    name: 'browser',
                    include: ['src/**/*.svelte.test.ts'],
                    // The site's stylesheet, so toBeVisible() means what it says.
                    setupFiles: ['src/lib/test-support/globalStyles.ts', 'src/lib/test-support/setup.ts'],
                    // expect.element retries until the test's own deadline, which in browser mode defaults to 15s, so
                    // a wrong assertion would sit for 15s before failing. Nothing here loads from anywhere slower
                    // than memory.
                    testTimeout: 3000,
                    browser: {
                        enabled: true,
                        headless: true,
                        provider: playwright(),
                        instances: [{ browser: 'chromium' }],
                        // The default is a phone's width, at which the site hides headers and navigation. A test
                        // about what a phone shows sets its own viewport and says so.
                        viewport: { width: 1280, height: 800 },
                    },
                },
            },
        ],
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
    server: { proxy: workerProxy },
    preview: { proxy: workerProxy },
});
