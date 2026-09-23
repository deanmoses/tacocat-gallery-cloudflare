import { Container } from '@cloudflare/containers';
import { AwsClient } from 'aws4fetch';
import ExifReader from 'exifreader';
import { and, asc, eq, max, sql } from 'drizzle-orm';
import { currentAdmin, routeAuth } from './auth';
import { db, schema, upsertItem, type Db } from './db';

interface Env {
    DB: D1Database;
    MEDIA: R2Bucket;
    DERIVED: R2Bucket;
    IMAGES: ImagesBinding;
    R2_ACCESS_KEY_ID: string;
    R2_SECRET_ACCESS_KEY: string;
    GLOBALPING_TOKEN?: string;
    SESSION_SECRET: string;
    TRANSCODER: DurableObjectNamespace<Transcoder>;
}

/** ffmpeg in a container; see transcoder/server.mjs. */
export class Transcoder extends Container {
    defaultPort = 8080;
    sleepAfter = '10s';
}

const R2_S3_ENDPOINT = 'https://ed3ca575118099486baeb129959697c8.r2.cloudflarestorage.com/tacocat-proto-media';

// Shape of an R2 event notification delivered through a Queue.
interface R2EventMessage {
    action: 'PutObject' | 'CopyObject' | 'CompleteMultipartUpload' | 'DeleteObject' | 'LifecycleDeletion';
    bucket: string;
    object: { key: string; size?: number; eTag?: string };
    eventTime: string;
}

const BOOKMARK_HEADER = 'x-d1-bookmark';
const BACKUP_CRON = '17 9 * * *';

export default {
    async fetch(request, env, ctx): Promise<Response> {
        const started = performance.now();
        const url = new URL(request.url);
        let res: Response;
        try {
            res = await route(request, env, url, ctx);
        } catch (e) {
            console.error({ event: 'server_exception', path: url.pathname, error: String(e) });
            res = json({ error: String(e) }, 500);
        }
        res = new Response(res.body, res);
        if (url.pathname.startsWith('/api/')) {
            res.headers.set('x-auth-status', (await currentAdmin(request, env)) ? 'admin' : 'guest');
        }
        res.headers.set('x-worker-colo', String(request.cf?.colo ?? 'local'));
        res.headers.set('server-timing', `worker;dur=${(performance.now() - started).toFixed(1)}`);
        return res;
    },

    async queue(batch, env): Promise<void> {
        for (const msg of batch.messages) {
            await processUploadEvent(msg.body as R2EventMessage, env);
            msg.ack();
        }
    },

    async scheduled(controller, env): Promise<void> {
        if (controller.cron === BACKUP_CRON) await backupDatabase(env);
        else await probeIdleLatency(env);
    },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, url: URL, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = url;
    const auth = await routeAuth(request, env, url);
    if (auth) return auth;
    if (pathname === '/') return json({ colo: request.cf?.colo, country: request.cf?.country });
    if (pathname.startsWith('/api/album/') && request.method === 'GET') return getAlbum(request, env, url);
    if (pathname === '/api/ryw' && request.method === 'GET') return readYourWrites(env);
    if (pathname === '/api/search' && request.method === 'GET') return search(env, url);
    if (pathname === '/upload-test') return new Response(UPLOAD_TEST_PAGE, { headers: { 'content-type': 'text/html' } });
    if (pathname.startsWith('/raw/')) return raw(env, url);
    if (pathname.startsWith('/v/')) return media(request, env, url);
    if (request.method === 'POST' || request.method === 'PUT') {
        if (!(await currentAdmin(request, env))) return json({ error: 'admin login required' }, 401);
        if (pathname === '/api/item') return putItem(request, env);
        if (pathname === '/api/seed') return seed(env, url);
        if (pathname === '/api/backup') return json(await backupDatabase(env));
        if (pathname === '/api/upload-url') return uploadUrl(request, env);
        if (pathname.startsWith('/upload/')) return upload(request, env, url);
    }
    if (pathname.startsWith('/debug/image/')) return debugImage(env, url);
    if (pathname.startsWith('/i/') && request.method === 'GET') return derivedViaCacheApi(request, env, url, ctx);
    if (pathname.startsWith('/i2/') && request.method === 'GET') return derivedViaCdn(env, url);
    return json({ error: 'not found' }, 404);
}

/**
 * Reads through the Sessions API so a nearby replica can answer. A client that just wrote passes the
 * bookmark it got back, which guarantees it reads its own write; ?consistency=primary forces the primary.
 */
async function getAlbum(request: Request, env: Env, url: URL): Promise<Response> {
    const albumPath = '/' + decodeURIComponent(url.pathname.slice('/api/album/'.length));
    const constraint =
        request.headers.get(BOOKMARK_HEADER) ??
        (url.searchParams.get('consistency') === 'primary' ? 'first-primary' : 'first-unconstrained');
    const session = env.DB.withSession(constraint);
    const t0 = performance.now();
    const { item } = schema;
    const children = await db(session).select().from(item).where(eq(item.parentPath, albumPath)).orderBy(item.itemName).run();
    const d1Ms = performance.now() - t0;
    return json(
        {
            path: albumPath,
            count: children.results.length,
            children: children.results,
            d1: { ...pickMeta(children.meta), roundTripMs: round(d1Ms) },
        },
        200,
        { [BOOKMARK_HEADER]: session.getBookmark() ?? '', 'x-d1': d1Header(children.meta, d1Ms) },
    );
}

async function putItem(request: Request, env: Env): Promise<Response> {
    const item = (await request.json()) as schema.NewItem;
    const session = env.DB.withSession('first-primary');
    const t0 = performance.now();
    const write = await upsertItem(db(session), item).run();
    const writeMs = performance.now() - t0;
    return json(
        { written: item, d1: { ...pickMeta(write.meta), roundTripMs: round(writeMs) } },
        200,
        { [BOOKMARK_HEADER]: session.getBookmark() ?? '' },
    );
}

/**
 * Saves from wherever this request lands, then reads back twice: once carrying the save's bookmark (what the
 * admin UI would do) and once in a fresh session (what another visitor nearby would see). GET so that
 * measurement services, which only issue GETs, can trigger it from other continents.
 */
async function readYourWrites(env: Env): Promise<Response> {
    const title = `ryw ${Date.now()}`;
    const key = { parentPath: '/ryw/', itemName: crypto.randomUUID() };
    const writer = env.DB.withSession('first-primary');
    let t0 = performance.now();
    const w = await upsertItem(db(writer), { ...key, itemType: 'image', title, published: true }).run();
    const writeMs = performance.now() - t0;
    const { item } = schema;
    const select = (d: Db) =>
        d
            .select({ title: item.title })
            .from(item)
            .where(and(eq(item.parentPath, key.parentPath), eq(item.itemName, key.itemName)))
            // run() rather than get() for the D1 meta (which replica answered); its rows are untyped.
            .run() as Promise<D1Result<{ title: string | null }>>;

    const reader = env.DB.withSession(writer.getBookmark() ?? 'first-primary');
    t0 = performance.now();
    const own = await select(db(reader));
    const ownMs = performance.now() - t0;

    const stranger = env.DB.withSession('first-unconstrained');
    t0 = performance.now();
    const other = await select(db(stranger));
    const otherMs = performance.now() - t0;

    const summary = [
        `write ${d1Header(w.meta, writeMs)}`,
        `own ${own.results[0]?.title === title} ${d1Header(own.meta, ownMs)}`,
        `fresh ${other.results[0]?.title === title} ${d1Header(other.meta, otherMs)}`,
    ].join('; ');
    return json({ summary }, 200, { 'x-d1': summary });
}

async function search(env: Env, url: URL): Promise<Response> {
    const q = url.searchParams.get('q') ?? '';
    const session = env.DB.withSession('first-unconstrained');
    const t0 = performance.now();
    // FTS5 is outside Drizzle's model, so this is raw SQL with a bound parameter.
    const rows = await db(session).run(
        sql`SELECT i.parent_path, i.item_name, i.title, snippet(item_fts, 2, '[', ']', '…', 8) AS snippet
            FROM item_fts JOIN item i ON i.id = item_fts.rowid
            WHERE item_fts MATCH ${q} ORDER BY rank LIMIT 50`,
    );
    const searchMs = performance.now() - t0;
    return json({
        q,
        count: rows.results.length,
        results: rows.results,
        d1: { ...pickMeta(rows.meta), roundTripMs: round(searchMs) },
    }, 200, { 'x-d1': d1Header(rows.meta, searchMs) });
}

/** Seeds synthetic years of albums and images so reads and search run against a gallery-sized table. */
async function seed(env: Env, url: URL): Promise<Response> {
    const years = Number(url.searchParams.get('years') ?? '3');
    const words = ['beach', 'birthday', 'snow', 'cat', 'taco', 'paris', 'marseille', 'hike', 'garden', 'soccer'];
    let written = 0;
    for (let y = 0; y < years; y++) {
        const year = String(2000 + y);
        const database = db(env.DB);
        const stmts: ReturnType<typeof upsertItem>[] = [];
        for (let d = 0; d < 60; d++) {
            const day = `${String((d % 12) + 1).padStart(2, '0')}-${String((d % 28) + 1).padStart(2, '0')}`;
            stmts.push(upsertItem(database, { parentPath: `/${year}/`, itemName: day, itemType: 'album', published: true }));
            for (let i = 0; i < 20; i++) {
                const w = words[(y + d + i) % words.length];
                stmts.push(
                    upsertItem(database, {
                        parentPath: `/${year}/${day}/`,
                        itemName: `img_${i}.jpg`,
                        itemType: 'image',
                        title: `${w} ${i}`,
                        description: `A photo about ${w} on ${year}-${day}`,
                        tags: w,
                        versionId: crypto.randomUUID(),
                        published: true,
                    }),
                );
            }
        }
        // D1 caps statements per batch; keep each batch well under it.
        for (let i = 0; i < stmts.length; i += 400) {
            const [first, ...rest] = stmts.slice(i, i + 400);
            await database.batch([first, ...rest]);
        }
        written += stmts.length;
    }
    return json({ written });
}


/**
 * Stand-in for the browser's presigned PUT: writes straight to R2 so the event notification path can be
 * exercised before S3 API credentials exist.
 */
async function upload(request: Request, env: Env, url: URL): Promise<Response> {
    const key = decodeURIComponent(url.pathname.slice('/upload/'.length));
    const obj = await env.MEDIA.put(`inbox/${key}`, request.body, {
        httpMetadata: { contentType: request.headers.get('content-type') ?? undefined },
    });
    return json({ key: obj?.key, size: obj?.size });
}

/** Presigned PUT straight to R2's S3 endpoint, so upload bytes never pass through the Worker. */
async function uploadUrl(request: Request, env: Env): Promise<Response> {
    const { path, contentType } = (await request.json()) as { path: string; contentType: string };
    const url = await presign(env, 'PUT', `inbox/${path.replace(/^\//, '')}`, contentType);
    return json({ url, contentType });
}

/** Presigned S3 URL, so upload and transcode bytes never pass through the Worker. */
async function presign(env: Env, method: 'GET' | 'PUT', key: string, contentType?: string): Promise<string> {
    const client = new AwsClient({
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        service: 's3',
        region: 'auto',
    });
    const target = new URL(`${R2_S3_ENDPOINT}/${key.split('/').map(encodeURIComponent).join('/')}`);
    target.searchParams.set('X-Amz-Expires', '3600');
    const headers = contentType ? { 'content-type': contentType } : undefined;
    const signed = await client.sign(new Request(target, { method, headers }), { aws: { signQuery: true } });
    return signed.url;
}

async function raw(env: Env, url: URL): Promise<Response> {
    const obj = await env.MEDIA.get(decodeURIComponent(url.pathname.slice('/raw/'.length)));
    if (!obj) return json({ error: 'not found' }, 404);
    return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream' } });
}

/** Byte-range serving, which video playback and seeking depend on. */
async function media(request: Request, env: Env, url: URL): Promise<Response> {
    const key = decodeURIComponent(url.pathname.slice('/v/'.length));
    const obj = await env.MEDIA.get(key, { range: request.headers });
    if (!obj) return json({ error: 'not found' }, 404);
    const headers = new Headers({ 'accept-ranges': 'bytes', etag: obj.httpEtag });
    obj.writeHttpMetadata(headers);
    if (request.headers.has('range') && obj.range && 'offset' in obj.range) {
        const start = obj.range.offset ?? 0;
        const end = start + (obj.range.length ?? obj.size - start) - 1;
        headers.set('content-range', `bytes ${start}-${end}/${obj.size}`);
        return new Response(obj.body, { status: 206, headers });
    }
    return new Response(obj.body, { headers });
}

/** Moves an inbox upload to its immutable key and records it, mirroring processMediaUpload. */
async function processUploadEvent(event: R2EventMessage, env: Env): Promise<void> {
    const key = event.object.key;
    if (!key.startsWith('inbox/') || event.action === 'DeleteObject') return;
    const obj = await env.MEDIA.get(key);
    if (!obj) return;
    const bytes = await obj.arrayBuffer();
    const galleryPath = key.slice('inbox'.length); // "/2024/06-15/photo.jpg"
    const slash = galleryPath.lastIndexOf('/');
    const parentPath = galleryPath.slice(0, slash + 1);
    const itemName = galleryPath.slice(slash + 1);
    const versionId = ulidish();

    let tags: ExifReader.Tags | undefined;
    try {
        tags = ExifReader.load(bytes, { expanded: false });
    } catch (e) {
        console.error({ event: 'exif_failed', key, error: String(e) });
    }
    const title = tagText(tags?.['Headline']) ?? tagText(tags?.['title']) ?? tagText(tags?.['ObjectName']);
    const description = tagText(tags?.['ImageDescription']) ?? tagText(tags?.['Caption/Abstract']);

    const originalKey = `originals${galleryPath}/${versionId}`;
    await env.MEDIA.put(originalKey, bytes, { httpMetadata: obj.httpMetadata });
    const isVideo = /\.(mp4|mov|m4v|avi)$/i.test(itemName);
    const video = isVideo ? await transcodeVideo(env, originalKey, `derived${galleryPath}/${versionId}`) : undefined;
    await upsertItem(db(env.DB), {
        parentPath,
        itemName,
        itemType: isVideo ? 'video' : 'image',
        title,
        description,
        versionId,
        published: false,
        ...video,
    }).run();
    await env.MEDIA.delete(key);
    console.info({ event: 'upload_processed', galleryPath, versionId, title, description, eventTime: event.eventTime });
}

interface TranscodeResult {
    source: Record<string, unknown>;
    output: { codedWidth: number; codedHeight: number; rotation: number; durationSeconds: number } & Record<string, unknown>;
    ms: Record<string, number>;
}

async function transcodeVideo(env: Env, originalKey: string, derivedPrefix: string) {
    const body = JSON.stringify({
        src: await presign(env, 'GET', originalKey),
        mp4Put: await presign(env, 'PUT', `${derivedPrefix}/video.mp4`, 'video/mp4'),
        posterPut: await presign(env, 'PUT', `${derivedPrefix}/poster.jpg`, 'image/jpeg'),
    });
    const started = Date.now();
    const res = await env.TRANSCODER.getByName('transcoder').fetch('http://transcoder/transcode', { method: 'POST', body });
    const text = await res.text();
    if (!res.ok) throw new Error(`transcode failed ${res.status}: ${text}`);
    const result = JSON.parse(text) as TranscodeResult;
    console.info({ event: 'video_transcoded', originalKey, wallMs: Date.now() - started, ...result });
    const quarterTurn = Math.abs(result.output.rotation) % 180 === 90;
    return {
        width: quarterTurn ? result.output.codedHeight : result.output.codedWidth,
        height: quarterTurn ? result.output.codedWidth : result.output.codedHeight,
        durationSeconds: result.output.durationSeconds,
    };
}

function tagText(tag: unknown): string | undefined {
    const d = (tag as { description?: unknown } | undefined)?.description;
    return typeof d === 'string' && d.trim() ? d.trim() : undefined;
}

/**
 * /i/<path>/<versionId>?size=200x200&crop=x,y,w,h — generated once with the Images binding, stored in the derived
 * bucket, served from it afterwards. Mirrors generateDerivedImage's crop-then-cover semantics.
 */
async function derivedImage(env: Env, url: URL, prefix: string): Promise<{ body: ArrayBuffer | ReadableStream; format: string; how: 'stored' | 'generated' } | Response> {
    const { rest, size, crop, format, key } = derivedKey(url, prefix);

    const stored = await env.DERIVED.get(key);
    if (stored) return { body: stored.body, format, how: 'stored' };

    const original = await env.MEDIA.get(`originals${rest}`);
    if (!original) return json({ error: 'original not found', key: `originals${rest}` }, 404);

    const [w, h] = size.split('x').map((n) => (n ? Number(n) : undefined));
    let t = env.IMAGES.input(original.body);
    if (crop) {
        const [left, top, width, height] = crop.split(',').map(Number);
        t = t.transform({ trim: { left, top, width, height } });
    }
    t = t.transform({ width: w, height: h, fit: w && h ? 'cover' : 'scale-down' });
    const out = await t.output({ format, quality: 85 });
    const bytes = await out.response().arrayBuffer();
    await env.DERIVED.put(key, bytes, { httpMetadata: { contentType: format, cacheControl: IMMUTABLE } });
    return { body: bytes, format, how: 'generated' };
}

function derivedKey(url: URL, prefix: string) {
    const rest = url.pathname.slice(prefix.length); // "/2024/06-15/photo.jpg/<versionId>"
    const size = url.searchParams.get('size') ?? '1024';
    const crop = url.searchParams.get('crop');
    const format = (url.searchParams.get('format') ?? 'image/jpeg') as ImageOutputOptions['format'];
    return { rest, size, crop, format, key: `derived${rest}/${size}${crop ? `-${crop}` : ''}-${format.split('/')[1]}` };
}

const IMMUTABLE = 'public, max-age=31536000, immutable';
const DERIVED_ORIGIN = 'https://img.deanmoses.com';

/** Worker in front, per-colo Cache API: a hit never reaches R2, but every colo fills from R2 on its own. */
async function derivedViaCacheApi(request: Request, env: Env, url: URL, ctx: ExecutionContext): Promise<Response> {
    const cache = caches.default;
    const hit = await cache.match(request);
    if (hit) {
        const res = new Response(hit.body, hit);
        res.headers.set('x-derived', 'cache-api-hit');
        return res;
    }
    const d = await derivedImage(env, url, '/i');
    if (d instanceof Response) return d;
    const res = new Response(d.body, { headers: { 'cache-control': IMMUTABLE, 'content-type': d.format } });
    ctx.waitUntil(cache.put(request, res.clone()));
    res.headers.set('x-derived', d.how);
    return res;
}

/**
 * Worker fetches the derivative through the derived bucket's custom domain, so it goes through the CDN cache and
 * Tiered Cache like any origin fetch. Generates on a 404.
 */
async function derivedViaCdn(env: Env, url: URL): Promise<Response> {
    const { key } = derivedKey(url, '/i2');
    // Only successes are cached: a 404 from before the derivative was generated would otherwise stick for a year.
    const upstream = await fetch(`${DERIVED_ORIGIN}/${key}`, {
        cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': 31536000, '400-599': -1 } },
    });
    if (upstream.ok) {
        const res = new Response(upstream.body, upstream);
        res.headers.set('x-derived', `cdn-${upstream.headers.get('cf-cache-status')?.toLowerCase() ?? 'unknown'}`);
        return res;
    }
    const d = await derivedImage(env, url, '/i2');
    if (d instanceof Response) return d;
    return new Response(d.body, { headers: { 'cache-control': IMMUTABLE, 'content-type': d.format, 'x-derived': d.how } });
}

/** Isolates Images binding failures from how the bytes reach it: R2 stream, buffered stream, and each step. */
async function debugImage(env: Env, url: URL): Promise<Response> {
    const key = decodeURIComponent(url.pathname.slice('/debug/image/'.length));
    const head = await env.MEDIA.get(key);
    if (!head) return json({ error: 'not found', key }, 404);
    const bytes = new Uint8Array(await head.arrayBuffer());
    const buffered = () => new Blob([bytes]).stream();
    const attempt = async (fn: () => Promise<unknown>) => {
        try {
            return { ok: true, value: await fn() };
        } catch (e) {
            return { ok: false, error: String(e) };
        }
    };
    return json({
        key,
        size: bytes.length,
        magic: new TextDecoder().decode(bytes.slice(4, 12)),
        infoFromR2Stream: await attempt(async () => env.IMAGES.info((await env.MEDIA.get(key))!.body)),
        infoBuffered: await attempt(() => env.IMAGES.info(buffered())),
        jpegNoTransform: await attempt(async () => {
            const r = (await env.IMAGES.input(buffered()).output({ format: 'image/jpeg' })).response();
            return { status: r.status, type: r.headers.get('content-type'), bytes: (await r.arrayBuffer()).byteLength };
        }),
        jpegWidth512: await attempt(async () => {
            const r = (await env.IMAGES.input(buffered()).transform({ width: 512 }).output({ format: 'image/jpeg' })).response();
            return { status: r.status, bytes: (await r.arrayBuffer()).byteLength };
        }),
    });
}

const PROBE_TARGET = 'tacocat-gallery-cloudflare.tacocat-gallery-cloudflare.workers.dev';

// Louisiana has a single Globalping probe, so Houston stands in when it is offline.
const PROBE_LOCATIONS: { name: string; options: Record<string, string>[][] }[] = [
    { name: 'Bay Area', options: [[{ country: 'US', state: 'CA', city: 'San Jose' }]] },
    { name: 'Los Angeles', options: [[{ country: 'US', state: 'CA', city: 'Los Angeles' }]] },
    { name: 'Paris', options: [[{ country: 'FR', city: 'Paris' }]] },
    { name: 'Louisiana', options: [[{ country: 'US', state: 'LA' }], [{ country: 'US', state: 'TX', city: 'Houston' }]] },
];

// The first request at each location is the one that finds the isolate and replica idle; the repeats, from the
// same probe, are the warm baseline.
const PROBE_SEQUENCE = [
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

/** Times reads through Globalping from each reader region, recording how long the Worker had been left alone. */
async function probeIdleLatency(env: Env): Promise<void> {
    const runAt = new Date().toISOString();
    const d = db(env.DB);
    const prev = await d.select({ runAt: max(schema.probeResult.runAt) }).from(schema.probeResult).get();
    const idleHours = prev?.runAt ? round((Date.parse(runAt) - Date.parse(prev.runAt)) / 3_600_000) : null;

    const rows = await Promise.all(
        PROBE_LOCATIONS.map(async (loc) => {
            const out: ReturnType<typeof probeRow>[] = [];
            let probeFrom: string | Record<string, string>[] | undefined;
            for (const [seq, step] of PROBE_SEQUENCE.entries()) {
                let m: GlobalpingMeasurement | undefined;
                let error: string | undefined;
                for (const option of probeFrom ? [probeFrom] : loc.options) {
                    try {
                        m = await globalping(env, option, step);
                        error = undefined;
                        break;
                    } catch (e) {
                        error = String(e);
                    }
                }
                probeFrom = m?.id ?? probeFrom;
                out.push(probeRow(d, { runAt, idleHours, location: loc.name, seq, path: step.path, m, error }));
            }
            return out;
        }),
    );
    const [first, ...rest] = rows.flat();
    await d.batch([first, ...rest]);
    console.info({ event: 'idle_probe_done', runAt, idleHours });
}

async function globalping(
    env: Env,
    locations: string | Record<string, string>[],
    request: { path: string; query?: string },
): Promise<GlobalpingMeasurement> {
    const created = await fetch('https://api.globalping.io/v1/measurements', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(env.GLOBALPING_TOKEN && { authorization: `Bearer ${env.GLOBALPING_TOKEN}` }),
        },
        body: JSON.stringify({
            type: 'http',
            target: PROBE_TARGET,
            locations,
            limit: 1,
            measurementOptions: { protocol: 'HTTPS', request: { ...request, method: 'GET' } },
        }),
    });
    if (!created.ok) throw new Error(`globalping create ${created.status}: ${(await created.text()).slice(0, 300)}`);
    const { id } = (await created.json()) as { id: string };
    for (let i = 0; i < 60; i++) {
        await scheduler.wait(500);
        const m = (await (await fetch(`https://api.globalping.io/v1/measurements/${id}`)).json()) as GlobalpingMeasurement;
        if (m.status !== 'in-progress') return m;
    }
    throw new Error(`globalping ${id} still in progress after 30 s`);
}

function probeRow(
    d: Db,
    r: { runAt: string; idleHours: number | null; location: string; seq: number; path: string; m?: GlobalpingMeasurement; error?: string },
) {
    const res = r.m?.results[0];
    const header = (name: string) => {
        const v = res?.result.headers?.[name];
        return Array.isArray(v) ? v[0] : v;
    };
    const d1 = Object.fromEntries((header('x-d1') ?? '').split(' ').map((kv) => kv.split('=')));
    const workerMs = header('server-timing')?.match(/dur=([\d.]+)/)?.[1];
    const t = res?.result.timings;
    const failed = res && res.result.status !== 'finished' ? res.result.rawOutput?.slice(0, 300) : undefined;
    return d.insert(schema.probeResult).values({
        runAt: r.runAt,
        idleHours: r.idleHours,
        location: r.location,
        seq: r.seq,
        path: r.path,
        probeCity: res?.probe.city,
        probeNetwork: res?.probe.network,
        status: res?.result.statusCode,
        totalMs: t?.total,
        dnsMs: t?.dns,
        tcpMs: t?.tcp,
        tlsMs: t?.tls,
        firstByteMs: t?.firstByte,
        workerColo: header('x-worker-colo'),
        workerMs: workerMs ? Number(workerMs) : null,
        d1Region: d1.region,
        d1Colo: d1.colo,
        d1Primary: d1.primary,
        d1RttMs: d1.rtt ? Number(d1.rtt) : null,
        measurementId: r.m?.id,
        error: r.error ?? failed,
    });
}

/** Nightly dump of the canonical table to R2; the FTS index is derived data and is rebuilt on restore. */
async function backupDatabase(env: Env): Promise<{ key: string; rows: number }> {
    const { item } = schema;
    const rows: schema.Item[] = [];
    let cursor = ['', ''];
    for (;;) {
        const page = await db(env.DB)
            .select()
            .from(item)
            .where(sql`(${item.parentPath}, ${item.itemName}) > (${cursor[0]}, ${cursor[1]})`)
            .orderBy(asc(item.parentPath), asc(item.itemName))
            .limit(5000)
            .all();
        rows.push(...page);
        if (page.length < 5000) break;
        const last = page.at(-1)!;
        cursor = [last.parentPath, last.itemName];
    }
    const key = `backups/d1/${new Date().toISOString()}.json`;
    await env.MEDIA.put(key, JSON.stringify({ table: 'item', rows }), {
        httpMetadata: { contentType: 'application/json' },
    });
    console.info({ event: 'd1_backup_written', key, rows: rows.length });
    return { key, rows: rows.length };
}

function pickMeta(meta: D1Meta) {
    return {
        servedByRegion: meta.served_by_region,
        servedByColo: meta.served_by_colo,
        servedByPrimary: meta.served_by_primary,
        sqlMs: meta.timings?.sql_duration_ms,
        rowsRead: meta.rows_read,
    };
}

function d1Header(meta: D1Meta, roundTripMs: number): string {
    return `region=${meta.served_by_region} colo=${meta.served_by_colo} primary=${meta.served_by_primary} sql=${meta.timings?.sql_duration_ms?.toFixed(1)} rtt=${round(roundTripMs)}`;
}

/** Time-sortable, URL-safe id standing in for S3's versionId. */
function ulidish(): string {
    return Date.now().toString(36).padStart(9, '0') + crypto.randomUUID().replaceAll('-', '').slice(0, 16);
}

function round(n: number): number {
    return Math.round(n * 10) / 10;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body, null, 2), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
    });
}

const UPLOAD_TEST_PAGE = `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>R2 upload test</title>
<style>body{font:15px system-ui;margin:16px;max-width:720px}pre{white-space:pre-wrap;background:#f4f4f4;padding:8px}</style>
<h1>Presigned PUT to R2</h1>
<p><input type="file" id="file" multiple accept="image/*,video/*"> <button id="self">Self-test with a fixture</button></p>
<pre id="log"></pre>
<script>
const log = (m) => (document.getElementById('log').textContent += m + '\\n');
const day = new Date().toISOString().slice(5, 10);
async function upload(name, blob) {
    const path = '/2025/' + day + '/' + name;
    const t0 = performance.now();
    const signed = await (await fetch('/api/upload-url', { method: 'POST', body: JSON.stringify({ path, contentType: blob.type || 'application/octet-stream' }) })).json();
    const t1 = performance.now();
    const put = await fetch(signed.url, { method: 'PUT', body: blob, headers: { 'content-type': signed.contentType } });
    const t2 = performance.now();
    log(name + ': sign ' + Math.round(t1 - t0) + ' ms, PUT ' + put.status + ' in ' + Math.round(t2 - t1) + ' ms (' + blob.size + ' bytes), ETag ' + put.headers.get('etag'));
    for (let i = 0; i < 30; i++) {
        const album = await (await fetch('/api/album/2025/' + day + '/?consistency=primary')).json();
        const item = album.children.find((c) => c.item_name === name);
        if (item) { log('  processed after ' + Math.round(performance.now() - t2) + ' ms: title=' + item.title + ' version=' + item.version_id); return; }
        await new Promise((r) => setTimeout(r, 1000));
    }
    log('  not processed after 30 s');
}
document.getElementById('file').onchange = async (e) => { for (const f of e.target.files) await upload(f.name, f); };
document.getElementById('self').onclick = async () => {
    const blob = await (await fetch('/raw/originals/2024/06-15/FullMetadata.jpg/0mudcdwwsdc76b9b2fc9b4169')).blob();
    await upload('selftest-' + Date.now() + '.jpg', new Blob([blob], { type: 'image/jpeg' }));
};
</script>`;
