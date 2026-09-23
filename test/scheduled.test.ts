import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import type { R2EventMessage } from '../src/upload';

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
    // Storage is shared by the tests in a file, so the count is relative to what was there.
    it('writes a dump to R2', async () => {
        const before = await env.MEDIA.list({ prefix: 'backups/d1/' });
        await runCron('17 9 * * *');
        const after = await env.MEDIA.list({ prefix: 'backups/d1/' });

        expect(after.objects).toHaveLength(before.objects.length + 1);
    });

    it('purges upload errors older than a day and keeps newer ones', async () => {
        const insert = env.DB.prepare('INSERT INTO upload_error (path, message, created_at) VALUES (?, ?, ?)');
        await env.DB.batch([
            insert.bind('/old.mov', 'stale', hoursAgo(25)),
            insert.bind('/new.mov', 'fresh', hoursAgo(23)),
        ]);
        await runCron('17 9 * * *');
        const { results } = await env.DB.prepare('SELECT path FROM upload_error ORDER BY path').all<{ path: string }>();

        expect(results.map((row) => row.path)).toStrictEqual(['/new.mov']);
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
        const { results } = await env.DB.prepare(
            'SELECT * FROM probe_result WHERE run_at = (SELECT max(run_at) FROM probe_result) ORDER BY location, seq',
        ).all();

        expect(results).toHaveLength(12);
        expect(results.at(0)).toMatchObject({
            location: 'Bay Area',
            seq: 0,
            path: '/api/album/2001/',
            probe_city: 'Paris',
            status: 200,
            total_ms: 60,
            worker_colo: 'CDG',
            worker_ms: 12.5,
            d1_region: 'WEUR',
            d1_colo: 'FRA',
            d1_primary: 'false',
            d1_rtt_ms: 20.1,
            measurement_id: 'm1',
            error: null,
        });
    });
});
