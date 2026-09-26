// Runs the photo-album journey against both sites from every DebugBear location, and reports what the runs measured.
// Each page in the DebugBear project is one site tested from one location, with the journey script attached as an
// advanced setting; which site a page tests is read from its URL.
//
// Usage: node api/scripts/debugbear.ts run                         a cold run of every page, then a warm one
//        node api/scripts/debugbear.ts report [--from YYYY-MM-DD]  every run since that day, and their medians
//        node api/scripts/debugbear.ts requests <analysis id>      when one run's page, first script and album
//                                                                  requests started and ended; `report` prints the id
//
// Reads DEBUGBEAR_API_KEY from the environment, or else from api/.dev.vars.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import * as valibot from 'valibot';

const API = 'https://www.debugbear.com/api/v1';
const PROJECT_ID = '107830';
const POLL_MS = 15_000;
const RUN_TIMEOUT_MS = 15 * 60_000;
// A run is warm when the same page ran this recently, since that run left the site's caches, isolates and replicas
// as a visitor just before would.
const WARM_WITHIN_MS = 30 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

const PROJECT = valibot.object({
    pages: valibot.array(valibot.object({ id: valibot.string(), url: valibot.string(), region: valibot.string() })),
});
const TRIGGERED = valibot.object({
    analysis: valibot.object({ id: valibot.union([valibot.string(), valibot.number()]) }),
});
const ANALYSIS = valibot.object({ hasFinished: valibot.boolean() });
const METRICS = valibot.array(valibot.record(valibot.string(), valibot.unknown()));
const REQUESTS = valibot.array(
    valibot.object({
        url: valibot.string(),
        resourceType: valibot.string(),
        /** Missing for a request the run ended before it answered. */
        status: valibot.optional(valibot.number()),
        startTime: valibot.number(),
        endTime: valibot.number(),
        earlyHint: valibot.optional(valibot.boolean()),
    }),
);

type Page = valibot.InferOutput<typeof PROJECT>['pages'][number];

interface Run {
    id: string;
    date: Date;
    location: string;
    site: string;
    warm: boolean;
    ttfb: number | undefined;
    lcp: number | undefined;
    photos: number[];
}

const apiKey = await readApiKey();

const [command, ...options] = process.argv.slice(2);
switch (command ?? '') {
    case 'run': {
        await runAll();
        break;
    }
    case 'report': {
        const from = options[options.indexOf('--from') + 1];
        await report(new Date(options.includes('--from') && from !== undefined ? from : Date.now() - DAY_MS));
        break;
    }
    case 'requests': {
        await albumRequests(options[0] ?? '');
        break;
    }
    default: {
        throw new Error(
            'Usage: node api/scripts/debugbear.ts run | report [--from YYYY-MM-DD] | requests <analysis id>',
        );
    }
}

async function runAll(): Promise<void> {
    const pages = await projectPages();
    for (const kind of ['cold', 'warm']) {
        const started = await Promise.all(pages.map(async (page) => analyze(page, kind)));
        await Promise.all(started.map(async (id) => finished(id)));
        console.info(`${kind} run of ${String(pages.length)} pages finished`);
    }
}

async function report(from: Date): Promise<void> {
    const pages = await projectPages();
    const runs = (await Promise.all(pages.map(async (page) => pageRuns(page, from)))).flat();
    runs.sort((one, other) => one.date.getTime() - other.date.getTime());
    console.info('UTC               location  site        kind  TTFB   LCP  photo 1  later photos (median)  analysis');
    for (const run of runs) {
        console.info(
            [
                run.date.toISOString().slice(0, 16).replace('T', ' '),
                run.location.padEnd(9),
                run.site.padEnd(10),
                (run.warm ? 'warm' : 'cold').padEnd(4),
                ms(run.ttfb, 5),
                ms(run.lcp, 5),
                ms(run.photos[0], 8),
                ms(median(run.photos.slice(1)), 8),
                ' '.repeat(13) + run.id,
            ].join(' '),
        );
    }
    console.info('\nMedians: location  site        kind  runs  TTFB   LCP  photo 1');
    const groups = Map.groupBy(runs, (run) => `${run.location} ${run.site} ${run.warm ? 'warm' : 'cold'}`);
    for (const [key, group] of [...groups].toSorted(([one], [other]) => one.localeCompare(other))) {
        const [location = '', site = '', kind = ''] = key.split(' ', 3);
        console.info(
            [
                ' '.repeat(8),
                location.padEnd(9),
                site.padEnd(10),
                kind.padEnd(4),
                String(group.length).padStart(4),
                ms(median(group.flatMap((run) => run.ttfb ?? [])), 5),
                ms(median(group.flatMap((run) => run.lcp ?? [])), 5),
                ms(median(group.flatMap((run) => run.photos[0] ?? [])), 8),
            ].join(' '),
        );
    }
}

/**
 * The page, its first script and every album request of one run, with when each started and ended in ms from the
 * page's start, so a waterfall can be read without the dashboard: whether the album JSON started with the page's
 * headers or after the app ran, and whether it was asked for once or twice.
 */
async function albumRequests(analysisId: string): Promise<void> {
    const requests = valibot.parse(REQUESTS, await debugbear(`/analysis/${analysisId}/requests`));
    const document = requests.find((request) => request.resourceType === 'document');
    const [firstScript] = requests
        .filter((request) => request.resourceType === 'script')
        .toSorted((one, other) => one.startTime - other.startTime);
    const albums = requests.filter((request) => request.url.includes('/api/album/'));
    console.info('  start     end  status  early hint  URL');
    for (const request of [document, firstScript, ...albums].flatMap((found) => found ?? [])) {
        console.info(
            [
                ms(request.startTime, 7),
                ms(request.endTime, 7),
                String(request.status ?? '-').padStart(6),
                String(request.earlyHint ?? '').padStart(11),
                ` ${request.url}`,
            ].join(' '),
        );
    }
}

async function projectPages(): Promise<Page[]> {
    return valibot.parse(PROJECT, await debugbear(`/projects/${PROJECT_ID}`)).pages;
}

async function analyze(page: Page, kind: string): Promise<string> {
    const body = { buildTitle: kind };
    const triggered = valibot.parse(TRIGGERED, await debugbear(`/page/${page.id}/analyze`, body));
    return String(triggered.analysis.id);
}

async function finished(analysisId: string): Promise<void> {
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    while (!valibot.parse(ANALYSIS, await debugbear(`/analysis/${analysisId}`)).hasFinished) {
        if (Date.now() > deadline) {
            throw new Error(`DebugBear analysis ${analysisId} still running after 15 minutes`);
        }
        await sleep(POLL_MS);
    }
}

/** Every run of one page since `from`, each marked warm when the page ran shortly before it. */
async function pageRuns(page: Page, from: Date): Promise<Run[]> {
    const query = new URLSearchParams({ from: from.toISOString().slice(0, 10), to: tomorrow() });
    const rows = valibot.parse(METRICS, await debugbear(`/page/${page.id}/metrics?${query.toString()}`));
    const dated = rows
        .map((row) => ({ row, date: new Date(String(row['analysis.date'])) }))
        .toSorted((one, other) => one.date.getTime() - other.date.getTime());
    return dated.map(({ row, date }, index) => {
        const previous = dated[index - 1]?.date;
        return {
            id: String(row['analysis.id']),
            date,
            location: page.region,
            site: new URL(page.url).hostname === 'pix.tacocat.com' ? 'AWS' : 'Cloudflare',
            warm: previous !== undefined && date.getTime() - previous.getTime() < WARM_WITHIN_MS,
            ttfb: numeric(row['performance.ttfb']),
            // DebugBear's own LCP keeps counting through the journey's clicks, so it measures a photo.
            lcp: numeric(row['measure.album-lcp']),
            photos: Object.keys(row)
                .filter((key) => key.startsWith('measure.photo-'))
                .toSorted()
                .flatMap((key) => numeric(row[key]) ?? []),
        };
    });
}

async function debugbear(route: string, body?: object): Promise<unknown> {
    const response = await fetch(`${API}${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
            'x-api-key': apiKey,
            // DebugBear refuses some default client user agents.
            'user-agent': 'tacocat-gallery-cloudflare',
            ...(body !== undefined && { 'content-type': 'application/json' }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
        throw new Error(`DebugBear ${route}: ${String(response.status)} ${(await response.text()).slice(0, 300)}`);
    }
    return response.json();
}

function numeric(value: unknown): number | undefined {
    return typeof value === 'number' ? value : undefined;
}

function median(values: number[]): number | undefined {
    const sorted = values.toSorted((one, other) => one - other);
    return sorted[Math.floor(sorted.length / 2)];
}

function ms(value: number | undefined, width: number): string {
    return (value === undefined ? '-' : String(Math.round(value))).padStart(width);
}

function tomorrow(): string {
    return new Date(Date.now() + DAY_MS).toISOString().slice(0, 10);
}

/** The key from the environment, or else as api/.dev.vars holds it, read here and never printed. */
async function readApiKey(): Promise<string> {
    const fromEnvironment = process.env['DEBUGBEAR_API_KEY'];
    if (fromEnvironment !== undefined && fromEnvironment !== '') {
        return fromEnvironment;
    }
    let text = '';
    try {
        text = await readFile(path.join(fileURLToPath(new URL('..', import.meta.url)), '.dev.vars'), 'utf8');
    } catch {
        // No api/.dev.vars, as in CI: the environment was the only place to look.
    }
    const line = text.split('\n').find((candidate) => candidate.startsWith('DEBUGBEAR_API_KEY='));
    const key = line?.slice(line.indexOf('=') + 1).trim() ?? '';
    if (key === '') {
        throw new Error('DEBUGBEAR_API_KEY is not set in the environment or api/.dev.vars');
    }
    return key;
}
