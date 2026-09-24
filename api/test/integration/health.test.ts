import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { call, callForJson } from '../helpers';

interface Health {
    version: string;
    tag: string;
    migration: string | null;
}

describe('GET /api/health', () => {
    it('names the running version and the newest migration', async () => {
        const body = await callForJson<Health>('/api/health');

        expect(body.version).toBe(env.CF_VERSION_METADATA.id);
        expect(body.migration).toBe(env.TEST_MIGRATIONS.at(-1)?.name);
    });

    it('names the latest migration by name, not the one applied last', async () => {
        await env.DB.prepare("INSERT INTO d1_migrations (name) VALUES ('00000000000000_older_branch.sql')").run();

        const body = await callForJson<Health>('/api/health');

        expect(body.migration).toBe(env.TEST_MIGRATIONS.at(-1)?.name);
    });

    it('fails when a bucket does not answer', async () => {
        vi.spyOn(env.DERIVED, 'head').mockRejectedValue(new Error('bucket unreachable'));

        const response = await call('/api/health');

        expect(response.status).toBe(500);
    });
});
