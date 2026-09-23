import { applyD1Migrations, reset } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, vi } from 'vitest';

// Every test starts from empty buckets and a freshly migrated database, so none can pass or fail because of what another
// left behind. reset() drops D1's tables along with its rows, so the migrations run again after it. Data a test needs
// goes in beforeEach, since this runs after any beforeAll and would erase what it wrote.
//
// No test reaches the internet either: a fetch the test has not stubbed fails, naming what it asked for.
beforeEach(async () => {
    await reset();
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const request = new Request(input);
        throw new Error(`Unstubbed fetch of ${request.method} ${request.url}; stub it in the test`);
    });
});
