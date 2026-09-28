import type { D1Migration } from 'cloudflare:test';

declare global {
    namespace Cloudflare {
        interface Env {
            TEST_MIGRATIONS: D1Migration[];
            SEARCH_INDEX: D1Migration[];
        }
    }
}
