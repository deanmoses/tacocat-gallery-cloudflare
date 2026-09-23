import { applyD1Migrations, reset } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach } from 'vitest';

// Every test starts from empty buckets and a freshly migrated database, so none can pass or fail because of what another
// left behind. reset() drops D1's tables along with its rows, so the migrations run again after it. Data a test needs
// goes in beforeEach, since this runs after any beforeAll and would erase what it wrote.
beforeEach(async () => {
    await reset();
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
