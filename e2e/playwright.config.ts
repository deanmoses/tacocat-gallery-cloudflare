import { defineConfig, devices } from '@playwright/test';
import { E2E_PORT, READY_PATH } from './gallery.ts';

const CI = process.env['CI'] !== undefined;
const ORIGIN = `http://localhost:${E2E_PORT}`;

export default defineConfig({
    testDir: '.',
    testMatch: '*.e2e.ts',
    // Tests within a file run in parallel too, not only files. On from the start: turning it on later means rereading
    // every test written on the assumption that it had the site to itself.
    fullyParallel: true,
    // A test.only left in a commit would otherwise run that one test and report green.
    forbidOnly: CI,
    retries: CI ? 2 : 0,
    // open: 'never' keeps a local failure from launching a browser and holding the terminal.
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: ORIGIN,
        // The trace of the attempt that failed. on-first-retry records nothing locally, where retries are off.
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    // Named, so the browser this runs and the one `playwright install chromium` downloads cannot drift apart.
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: 'node server.ts',
        // Ready once the gallery is written, not just once the port answers. A server already running from an earlier
        // `node e2e/server.ts` is reused, which skips the build while writing tests.
        url: `${ORIGIN}${READY_PATH}`,
        reuseExistingServer: !CI,
        // The web app's build and the migrations come first.
        timeout: 120_000,
    },
});
