import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { asc } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { orm, schema } from '../../src/db';
import { handler } from '../helpers';

function hoursAgo(hours: number): string {
    const at = new Date(Date.now() - hours * 3_600_000);
    return at.toISOString();
}

async function runCron(cron: string): Promise<void> {
    const ctx = createExecutionContext();
    await handler.scheduled?.(createScheduledController({ cron, scheduledTime: Date.now() }), env, ctx);
    await waitOnExecutionContext(ctx);
}

describe('nightly cron', () => {
    it('purges upload errors older than a day and keeps newer ones', async () => {
        const { uploadError } = schema;
        const database = orm(env.DB);
        await database.insert(uploadError).values([
            { path: '/2024/06-15/old', message: 'stale', createdAt: hoursAgo(26), updatedAt: hoursAgo(25) },
            { path: '/2024/06-15/new', message: 'fresh', createdAt: hoursAgo(26), updatedAt: hoursAgo(23) },
        ]);
        await runCron('17 9 * * *');
        const kept = await database.select({ path: uploadError.path }).from(uploadError).orderBy(asc(uploadError.path));

        expect(kept).toStrictEqual([{ path: '/2024/06-15/new' }]);
    });

    it('purges spent login challenges once they have expired', async () => {
        const { spentChallenge } = schema;
        const database = orm(env.DB);
        await database.insert(spentChallenge).values([
            { challenge: 'expired', expiresAt: hoursAgo(1) },
            { challenge: 'live', expiresAt: hoursAgo(-1) },
        ]);
        await runCron('17 9 * * *');
        const kept = await database.select({ challenge: spentChallenge.challenge }).from(spentChallenge);

        expect(kept).toStrictEqual([{ challenge: 'live' }]);
    });
});

describe('a cron the Worker does not name', () => {
    it('runs nothing, so a schedule an older release left behind is harmless', async () => {
        const { uploadError } = schema;
        const database = orm(env.DB);
        await database
            .insert(uploadError)
            .values({ path: '/2024/06-15/old', message: 'stale', createdAt: hoursAgo(26), updatedAt: hoursAgo(25) })
            .run();
        const warn = vi.spyOn(console, 'warn').mockReturnValue();
        await runCron('0 0 1 1 *');
        const kept = await database.select({ path: uploadError.path }).from(uploadError);

        expect(kept).toStrictEqual([{ path: '/2024/06-15/old' }]);
        expect(warn).toHaveBeenCalledWith({ event: 'unknown_cron', cron: '0 0 1 1 *' });
    });
});
