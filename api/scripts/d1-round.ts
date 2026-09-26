// One round of album reads through Globalping, and what the Worker's headers said about each: where the Worker ran,
// how long it spent, and which D1 instance answered and how long that took. The first location makes a first read and
// then repeats from the same probe a second apart, so the first read is the one that finds the colo's connection to
// D1 idle and the repeats show what the replica does next; each later location makes two reads.
//
// Usage: node api/scripts/d1-round.ts <host> <path> [--repeats 3] [--from paris,sanjose]
//        node api/scripts/d1-round.ts pix.deanmoses.com /api/album/2025/09-29/
//
// Locations: paris, marseille, sanjose, losangeles, batonrouge. Reads GLOBALPING_TOKEN from api/.dev.vars and never
// prints it. Every read reaches the site, so a round is not idle for the round after it: leave 20 minutes or more
// between rounds for the replicas to go inactive, and an hour for the primary.
import { setTimeout as sleep } from 'node:timers/promises';
import * as valibot from 'valibot';
import { devVars } from './dev-vars.ts';

const API = 'https://api.globalping.io/v1/measurements';
const POLL_MS = 500;
const POLL_ATTEMPTS = 60;

const LOCATIONS: Record<string, Record<string, string>[]> = {
    paris: [{ country: 'FR', city: 'Paris' }],
    marseille: [{ country: 'FR', city: 'Marseille' }],
    sanjose: [{ country: 'US', state: 'CA', city: 'San Jose' }],
    losangeles: [{ country: 'US', state: 'CA', city: 'Los Angeles' }],
    batonrouge: [{ country: 'US', state: 'LA' }],
};

const HEADERS = valibot.record(valibot.string(), valibot.union([valibot.string(), valibot.array(valibot.string())]));
const MEASUREMENT = valibot.object({
    id: valibot.string(),
    status: valibot.string(),
    results: valibot.array(
        valibot.object({
            probe: valibot.object({ city: valibot.string(), network: valibot.string() }),
            result: valibot.object({
                status: valibot.string(),
                statusCode: valibot.optional(valibot.number()),
                headers: valibot.optional(HEADERS),
                timings: valibot.optional(
                    valibot.object({
                        total: valibot.nullable(valibot.number()),
                        firstByte: valibot.nullable(valibot.number()),
                        tcp: valibot.nullable(valibot.number()),
                        tls: valibot.nullable(valibot.number()),
                    }),
                ),
                rawOutput: valibot.optional(valibot.string()),
            }),
        }),
    ),
});
type Measurement = valibot.InferOutput<typeof MEASUREMENT>;

const round = parseArguments(process.argv.slice(2));
const token = await readToken();

console.info('UTC time                  request       probe                     first byte  worker  colo  x-d1');
for (const [index, name] of round.names.entries()) {
    const reads = index === 0 ? 1 + round.repeats : 2;
    // The first measurement names the location; the ones after it name that measurement, which pins its probe.
    let from: string | Record<string, string>[] = LOCATIONS[name] ?? [];
    for (let seq = 1; seq <= reads; seq++) {
        const measurement = await measure(from);
        from = measurement.id;
        report(`${name} #${String(seq)}`, measurement);
    }
}

function parseArguments(argv: string[]): { host: string; requestPath: string; repeats: number; names: string[] } {
    const [host, requestPath, ...options] = argv;
    if (host === undefined || requestPath === undefined) {
        throw new Error('Usage: node api/scripts/d1-round.ts <host> <path> [--repeats 3] [--from paris,sanjose]');
    }
    const names = (option(options, '--from') ?? 'paris,sanjose').split(',');
    const unknown = names.find((name) => LOCATIONS[name] === undefined);
    if (unknown !== undefined) {
        throw new Error(`Unknown location ${unknown}; one of ${Object.keys(LOCATIONS).join(', ')}`);
    }
    return { host, requestPath, repeats: Number(option(options, '--repeats') ?? '3'), names };
}

async function readToken(): Promise<string> {
    const value = (await devVars())['GLOBALPING_TOKEN'] ?? '';
    if (value === '') {
        throw new Error('GLOBALPING_TOKEN is not in api/.dev.vars');
    }
    return value;
}

function option(options: string[], flag: string): string | undefined {
    const at = options.indexOf(flag);
    return at === -1 ? undefined : options[at + 1];
}

async function measure(from: string | Record<string, string>[]): Promise<Measurement> {
    const created = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
            type: 'http',
            target: round.host,
            locations: from,
            limit: 1,
            measurementOptions: { protocol: 'HTTPS', request: { path: round.requestPath, method: 'GET' } },
        }),
    });
    if (!created.ok) {
        throw new Error(`Globalping ${String(created.status)}: ${(await created.text()).slice(0, 300)}`);
    }
    const { id } = valibot.parse(valibot.object({ id: valibot.string() }), await created.json());
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
        await sleep(POLL_MS);
        const measurement = valibot.parse(MEASUREMENT, await (await fetch(`${API}/${id}`)).json());
        if (measurement.status !== 'in-progress') {
            return measurement;
        }
    }
    throw new Error(
        `Globalping measurement ${id} still in progress after ${String((POLL_MS * POLL_ATTEMPTS) / 1000)} s`,
    );
}

function report(label: string, measurement: Measurement): void {
    const [answer] = measurement.results;
    if (answer === undefined) {
        console.info(`${new Date().toISOString()}  ${label.padEnd(12)}  no probe answered`);
        return;
    }
    const { result } = answer;
    const header = (name: string): string => {
        const value = result.headers?.[name];
        return (Array.isArray(value) ? value[0] : value) ?? '-';
    };
    const worker = /dur=(?<ms>[\d.]+)/v.exec(header('server-timing'))?.groups?.['ms'] ?? '-';
    console.info(
        [
            new Date().toISOString(),
            label.padEnd(12),
            `${answer.probe.city} (${answer.probe.network})`.padEnd(25),
            `${String(result.timings?.firstByte ?? '-')} ms`.padStart(10),
            `${worker} ms`.padStart(7),
            header('x-worker-colo').padEnd(4),
            header('x-d1'),
        ].join('  '),
    );
    if (result.status !== 'finished') {
        console.info(`    ${result.status}: ${(result.rawOutput ?? '').slice(0, 300)}`);
    }
}
