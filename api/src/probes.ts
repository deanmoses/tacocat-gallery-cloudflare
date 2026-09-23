import { max } from 'drizzle-orm';
import type { SQLiteInsertBase } from 'drizzle-orm/sqlite-core';
import { type Orm, orm, schema } from './db';
import { round } from './db/timing';

const PROBE_TARGET = 'tacocat-gallery-cloudflare.tacocat-gallery-cloudflare.workers.dev';

type ProbeFrom = string | Record<string, string>[];

// Louisiana has a single Globalping probe, so Houston stands in when it is offline.
const PROBE_LOCATIONS: { name: string; options: ProbeFrom[] }[] = [
    { name: 'Bay Area', options: [[{ country: 'US', state: 'CA', city: 'San Jose' }]] },
    { name: 'Los Angeles', options: [[{ country: 'US', state: 'CA', city: 'Los Angeles' }]] },
    { name: 'Paris', options: [[{ country: 'FR', city: 'Paris' }]] },
    {
        name: 'Louisiana',
        options: [[{ country: 'US', state: 'LA' }], [{ country: 'US', state: 'TX', city: 'Houston' }]],
    },
];

interface ProbeStep {
    path: string;
    query?: string;
}

// The first request at each location is the one that finds the isolate and replica idle; the repeats, from the
// Same probe, are the warm baseline.
const PROBE_SEQUENCE: ProbeStep[] = [
    { path: '/api/album/2001/' },
    { path: '/api/album/2001/' },
    { path: '/api/search', query: 'q=marseille' },
];

interface GlobalpingMeasurement {
    id: string;
    status: 'in-progress' | 'finished';
    results: {
        probe: { city: string; network: string };
        result: {
            status: string;
            statusCode?: number;
            headers?: Record<string, string | string[]>;
            timings?: { total: number; dns: number | null; tcp: number; tls: number | null; firstByte: number };
            rawOutput?: string;
        };
    }[];
}

interface ProbeOutcome {
    runAt: string;
    idleHours: number | null;
    location: string;
    seq: number;
    path: string;
    measurement: GlobalpingMeasurement | undefined;
    error: string | undefined;
}

/** Times reads through Globalping from each reader region, recording how long the Worker had been left alone. */
export async function probeIdleLatency(env: Env): Promise<void> {
    const now = new Date();
    const runAt = now.toISOString();
    const database = orm(env.DB);
    const previous = await database
        .select({ runAt: max(schema.probeResult.runAt) })
        .from(schema.probeResult)
        .get();
    const lastRunAt = previous?.runAt ?? null;
    const idleHours = lastRunAt === null ? null : round((Date.parse(runAt) - Date.parse(lastRunAt)) / 3_600_000);

    const outcomes = await Promise.all(
        PROBE_LOCATIONS.map(async (location) =>
            probeLocation(env, { runAt, idleHours, location, pinned: undefined }, PROBE_SEQUENCE.entries().toArray()),
        ),
    );
    const [first, ...rest] = outcomes.flat().map((outcome) => probeRow(database, outcome));
    if (first) {
        await database.batch([first, ...rest]);
    }
    console.info({ event: 'idle_probe_done', runAt, idleHours });
}

interface LocationRun {
    runAt: string;
    idleHours: number | null;
    location: (typeof PROBE_LOCATIONS)[number];
    /** The probe that answered the previous step, so every step comes from the same machine. */
    pinned: ProbeFrom | undefined;
}

/** Runs `steps` from one location in order, since the first is the one that finds the Worker idle. */
async function probeLocation(env: Env, run: LocationRun, steps: [number, ProbeStep][]): Promise<ProbeOutcome[]> {
    const [next, ...rest] = steps;
    if (next === undefined) {
        return [];
    }
    const [seq, step] = next;
    const { measurement, error } = await firstAnswer(
        env,
        run.pinned === undefined ? run.location.options : [run.pinned],
        step,
    );
    const outcome = {
        runAt: run.runAt,
        idleHours: run.idleHours,
        location: run.location.name,
        seq,
        path: step.path,
        measurement,
        error,
    };
    const later = await probeLocation(env, { ...run, pinned: measurement?.id ?? run.pinned }, rest);
    return [outcome, ...later];
}

/** Tries each way of naming a location in turn, stopping at the first that yields a measurement. */
async function firstAnswer(
    env: Env,
    options: ProbeFrom[],
    step: ProbeStep,
): Promise<{ measurement: GlobalpingMeasurement | undefined; error: string | undefined }> {
    const [option, ...fallbacks] = options;
    if (option === undefined) {
        return { measurement: undefined, error: 'no location to probe from' };
    }
    try {
        return { measurement: await globalping(env, option, step), error: undefined };
    } catch (error) {
        // When every option fails, the last one's error is the one reported.
        return fallbacks.length === 0
            ? { measurement: undefined, error: String(error) }
            : firstAnswer(env, fallbacks, step);
    }
}

async function globalping(env: Env, locations: ProbeFrom, request: ProbeStep): Promise<GlobalpingMeasurement> {
    const created = await fetch('https://api.globalping.io/v1/measurements', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(env.GLOBALPING_TOKEN !== '' && { authorization: `Bearer ${env.GLOBALPING_TOKEN}` }),
        },
        body: JSON.stringify({
            type: 'http',
            target: PROBE_TARGET,
            locations,
            limit: 1,
            measurementOptions: { protocol: 'HTTPS', request: { ...request, method: 'GET' } },
        }),
    });
    if (!created.ok) {
        const text = await created.text();
        throw new Error(`globalping create ${created.status}: ${text.slice(0, 300)}`);
    }
    const { id } = await created.json<{ id: string }>();
    return pollMeasurement(id, 60);
}

/** Checks every half second until the measurement finishes, giving up after `attempts`. */
async function pollMeasurement(id: string, attempts: number): Promise<GlobalpingMeasurement> {
    if (attempts === 0) {
        throw new Error(`globalping ${id} still in progress after 30 s`);
    }
    await scheduler.wait(500);
    const response = await fetch(`https://api.globalping.io/v1/measurements/${id}`);
    const measurement = await response.json<GlobalpingMeasurement>();
    return measurement.status === 'in-progress' ? pollMeasurement(id, attempts - 1) : measurement;
}

function probeRow(
    database: Orm,
    outcome: ProbeOutcome,
): SQLiteInsertBase<typeof schema.probeResult, 'async', D1Result> {
    const result = outcome.measurement?.results[0];
    const timings = result?.result.timings;
    const failed = result && result.result.status !== 'finished' ? result.result.rawOutput?.slice(0, 300) : undefined;
    return database.insert(schema.probeResult).values({
        runAt: outcome.runAt,
        idleHours: outcome.idleHours,
        location: outcome.location,
        seq: outcome.seq,
        path: outcome.path,
        probeCity: result?.probe.city,
        probeNetwork: result?.probe.network,
        status: result?.result.statusCode,
        totalMs: timings?.total,
        dnsMs: timings?.dns,
        tcpMs: timings?.tcp,
        tlsMs: timings?.tls,
        firstByteMs: timings?.firstByte,
        ...workerReport(result?.result.headers ?? {}),
        measurementId: outcome.measurement?.id,
        error: outcome.error ?? failed,
    });
}

/** What the Worker said about itself in its response headers: where it ran, how long, and where D1 answered. */
export function workerReport(headers: Record<string, string | string[]>): {
    workerColo: string | undefined;
    workerMs: number | null;
    d1Region: string | undefined;
    d1Colo: string | undefined;
    d1Primary: string | undefined;
    d1RttMs: number | null;
} {
    const header = (name: string): string | undefined => {
        const value = headers[name];
        return Array.isArray(value) ? value[0] : value;
    };
    const d1 = new Map(
        (header('x-d1') ?? '').split(' ').map((pair): [string, string | undefined] => {
            const [key = '', value] = pair.split('=', 2);
            return [key, value];
        }),
    );
    const workerMs = /dur=(?<ms>[\d.]+)/v.exec(header('server-timing') ?? '')?.groups?.['ms'];
    const d1Rtt = d1.get('rtt');
    return {
        workerColo: header('x-worker-colo'),
        workerMs: workerMs === undefined ? null : Number(workerMs),
        d1Region: d1.get('region'),
        d1Colo: d1.get('colo'),
        d1Primary: d1.get('primary'),
        d1RttMs: d1Rtt === undefined || d1Rtt === '' ? null : Number(d1Rtt),
    };
}
