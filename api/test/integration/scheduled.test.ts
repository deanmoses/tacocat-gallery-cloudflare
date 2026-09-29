import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { asc } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { orm, schema } from '../../src/db';
import worker from '../../src/index';
import type { R2EventMessage } from '../../src/gallery/upload';

// Through the platform's handler type, which passes the execution context the Worker's own methods ignore.
const handler: ExportedHandler<Env, R2EventMessage> = worker;

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

describe('browser run crons', () => {
    /** Answers DebugBear: the project lists two pages, and starting a test on either returns an analysis. */
    function stubDebugbear(): Request[] {
        const requests: Request[] = [];
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const request = new Request(input, init);
            requests.push(request);
            return Response.json(
                request.method === 'POST'
                    ? { analysis: { id: 'a1' } }
                    : {
                          pages: [
                              { id: '11', url: 'https://pix.deanmoses.com/2025/09-29', region: 'france' },
                              { id: '12', url: 'https://pix.tacocat.com/2025/09-29', region: 'france' },
                          ],
                      },
            );
        });
        return requests;
    }

    it.each([
        { name: 'cold', cron: '23 5,11,19,22 * * *' },
        { name: 'warm', cron: '38 5,11,19,22 * * *' },
    ])('starts a $name run of every page in the DebugBear project, with the API key', async ({ name, cron }) => {
        const requests = stubDebugbear();
        await runCron(cron);
        const starts = requests.filter((request) => request.method === 'POST');
        const titles = await Promise.all(
            starts.map(async (request) => (await request.json<{ buildTitle: string }>()).buildTitle),
        );

        expect(starts.map((request) => request.url)).toStrictEqual([
            'https://www.debugbear.com/api/v1/page/11/analyze',
            'https://www.debugbear.com/api/v1/page/12/analyze',
        ]);
        expect(titles).toStrictEqual([name, name]);
        expect(requests.map((request) => request.headers.get('x-api-key'))).toStrictEqual(
            Array.from({ length: 3 }, () => 'test-debugbear-key'),
        );
    });
});
