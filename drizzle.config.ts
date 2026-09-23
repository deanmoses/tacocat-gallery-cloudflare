import { defineConfig } from 'drizzle-kit';

// drizzle-kit only writes migrations; `wrangler d1 migrations apply` runs them. Timestamp prefixes sort after the
// hand-written 0001 to 0005 that predate Drizzle.
export default defineConfig({
    dialect: 'sqlite',
    schema: './src/db/schema.ts',
    out: './migrations',
    migrations: { prefix: 'timestamp' },
});
