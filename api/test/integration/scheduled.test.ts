import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { asc } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { orm, schema } from '../../src/db';
import worker from '../../src/index';
import type { R2EventMessage } from '../../src/upload';

// Through the platform's handler type, which passes the execution context the Worker's own methods ignore.
const handler: ExportedHandler<Env, R2EventMessage> = worker;

/** A finished Globalping measurement, as if a probe in Paris had fetched a page from the Worker. */
const MEASUREMENT = {
    id: 'm1',
    status: 'finished',
    results: [
        {
            probe: { city: 'Paris', network: 'Example' },
            result: {
                status: 'finished',
                statusCode: 200,
                headers: {
                    'x-worker-colo': 'CDG',
                    'server-timing': 'worker;dur=12.5',
                    'x-d1': 'region=WEUR colo=FRA primary=false sql=0.3 rtt=20.1',
                },
                timings: { total: 60, dns: 5, tcp: 10, tls: 15, firstByte: 40 },
            },
        },
    ],
};

function hoursAgo(hours: number): string {
    const at = new Date(Date.now() - hours * 3_600_000);
    return at.toISOString();
}

async function runCron(cron: string): Promise<void> {
    const ctx = createExecutionContext();
    await handler.scheduled?.(createScheduledController({ cron, scheduledTime: Date.now() }), env, ctx);
    await waitOnExecutionContext(ctx);
}

/** Answers every Globalping call: creating a measurement returns its id, polling returns MEASUREMENT. */
function stubGlobalping(): Request[] {
    const requests: Request[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        return Response.json(request.method === 'POST' ? { id: 'm1' } : MEASUREMENT);
    });
    return requests;
}

describe('nightly cron', () => {
    it('writes a dump to R2', async () => {
        await runCron('17 9 * * *');
        const backups = await env.MEDIA.list({ prefix: 'backups/d1/' });

        expect(backups.objects).toHaveLength(1);
    });

    it('purges upload errors older than a day and keeps newer ones', async () => {
        const { uploadError } = schema;
        const database = orm(env.DB);
        await database.insert(uploadError).values([
            { path: '/old.mov', message: 'stale', createdAt: hoursAgo(25) },
            { path: '/new.mov', message: 'fresh', createdAt: hoursAgo(23) },
        ]);
        await runCron('17 9 * * *');
        const kept = await database.select({ path: uploadError.path }).from(uploadError).orderBy(asc(uploadError.path));

        expect(kept).toStrictEqual([{ path: '/new.mov' }]);
    });
});

describe('idle latency probe cron', () => {
    it('asks Globalping with the account token', async () => {
        const requests = stubGlobalping();
        await runCron('23 0,1,3,7,15 * * *');
        const creates = requests.filter((request) => request.method === 'POST');

        expect(requests.every((request) => request.url.startsWith('https://api.globalping.io/v1/measurements'))).toBe(
            true,
        );
        expect(creates).toHaveLength(12);
        expect(creates.map((request) => request.headers.get('authorization'))).toStrictEqual(
            Array.from({ length: 12 }, () => 'Bearer test-globalping-token'),
        );
    });

    it('records one row per location and step, from Globalping results', async () => {
        stubGlobalping();
        await runCron('23 0,1,3,7,15 * * *');
        const { probeResult } = schema;
        const rows = await orm(env.DB)
            .select()
            .from(probeResult)
            .orderBy(asc(probeResult.location), asc(probeResult.seq));

        expect(rows).toHaveLength(12);
        expect(rows.at(0)).toMatchObject({
            location: 'Bay Area',
            seq: 0,
            path: '/api/album/2001/',
            probeCity: 'Paris',
            status: 200,
            totalMs: 60,
            workerColo: 'CDG',
            workerMs: 12.5,
            d1Region: 'WEUR',
            d1Colo: 'FRA',
            d1Primary: 'false',
            d1RttMs: 20.1,
            measurementId: 'm1',
            error: null,
        });
    });
});
