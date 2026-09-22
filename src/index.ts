import ExifReader from 'exifreader';

interface Env {
    DB: D1Database;
    MEDIA: R2Bucket;
    IMAGES: ImagesBinding;
}

// Shape of an R2 event notification delivered through a Queue.
interface R2EventMessage {
    action: 'PutObject' | 'CopyObject' | 'CompleteMultipartUpload' | 'DeleteObject' | 'LifecycleDeletion';
    bucket: string;
    object: { key: string; size?: number; eTag?: string };
    eventTime: string;
}

type ItemInput = {
    parentPath: string;
    itemName: string;
    itemType: 'album' | 'image' | 'video';
    title?: string;
    description?: string;
    tags?: string;
    versionId?: string;
    published?: boolean;
};

const BOOKMARK_HEADER = 'x-d1-bookmark';

export default {
    async fetch(request, env): Promise<Response> {
        const started = performance.now();
        const url = new URL(request.url);
        let res: Response;
        try {
            res = await route(request, env, url);
        } catch (e) {
            console.error({ event: 'server_exception', path: url.pathname, error: String(e) });
            res = json({ error: String(e) }, 500);
        }
        res = new Response(res.body, res);
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

    async scheduled(_controller, env): Promise<void> {
        await backupDatabase(env);
    },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, url: URL): Promise<Response> {
    const { pathname } = url;
    if (pathname === '/') return json({ colo: request.cf?.colo, country: request.cf?.country });
    if (pathname.startsWith('/api/album/') && request.method === 'GET') return getAlbum(request, env, url);
    if (pathname === '/api/item' && request.method === 'POST') return putItem(request, env);
    if (pathname === '/api/search' && request.method === 'GET') return search(env, url);
    if (pathname === '/api/seed' && request.method === 'POST') return seed(env, url);
    if (pathname === '/api/backup' && request.method === 'POST') return json(await backupDatabase(env));
    if (pathname.startsWith('/upload/') && request.method === 'PUT') return upload(request, env, url);
    if (pathname.startsWith('/i/') && request.method === 'GET') return derivedImage(env, url);
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
    const children = await session
        .prepare('SELECT * FROM item WHERE parent_path = ? ORDER BY item_name')
        .bind(albumPath)
        .run();
    const d1Ms = performance.now() - t0;
    return json(
        {
            path: albumPath,
            count: children.results.length,
            children: children.results,
            d1: { ...pickMeta(children.meta), roundTripMs: round(d1Ms) },
        },
        200,
        { [BOOKMARK_HEADER]: session.getBookmark() ?? '' },
    );
}

async function putItem(request: Request, env: Env): Promise<Response> {
    const item = (await request.json()) as ItemInput;
    const session = env.DB.withSession('first-primary');
    const t0 = performance.now();
    const write = await upsertItem(session, item).run();
    const writeMs = performance.now() - t0;
    return json(
        { written: item, d1: { ...pickMeta(write.meta), roundTripMs: round(writeMs) } },
        200,
        { [BOOKMARK_HEADER]: session.getBookmark() ?? '' },
    );
}

function upsertItem(db: D1Database | D1DatabaseSession, item: ItemInput): D1PreparedStatement {
    return db
        .prepare(
            `INSERT INTO item (parent_path, item_name, item_type, title, description, tags, version_id, published)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT (parent_path, item_name) DO UPDATE SET
                title = excluded.title, description = excluded.description, tags = excluded.tags,
                version_id = excluded.version_id, published = excluded.published,
                updated_on = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
        )
        .bind(
            item.parentPath,
            item.itemName,
            item.itemType,
            item.title ?? null,
            item.description ?? null,
            item.tags ?? null,
            item.versionId ?? null,
            item.published ? 1 : 0,
        );
}

async function search(env: Env, url: URL): Promise<Response> {
    const q = url.searchParams.get('q') ?? '';
    const session = env.DB.withSession('first-unconstrained');
    const t0 = performance.now();
    const rows = await session
        .prepare(
            `SELECT parent_path, item_name, title, snippet(item_fts, 3, '[', ']', '…', 8) AS snippet
             FROM item_fts WHERE item_fts MATCH ?1 ORDER BY rank LIMIT 50`,
        )
        .bind(q)
        .run();
    return json({
        q,
        count: rows.results.length,
        results: rows.results,
        d1: { ...pickMeta(rows.meta), roundTripMs: round(performance.now() - t0) },
    });
}

/** Seeds synthetic years of albums and images so reads and search run against a gallery-sized table. */
async function seed(env: Env, url: URL): Promise<Response> {
    const years = Number(url.searchParams.get('years') ?? '3');
    const words = ['beach', 'birthday', 'snow', 'cat', 'taco', 'paris', 'marseille', 'hike', 'garden', 'soccer'];
    let written = 0;
    for (let y = 0; y < years; y++) {
        const year = String(2000 + y);
        const stmts: D1PreparedStatement[] = [];
        for (let d = 0; d < 60; d++) {
            const day = `${String((d % 12) + 1).padStart(2, '0')}-${String((d % 28) + 1).padStart(2, '0')}`;
            stmts.push(upsertItem(env.DB, { parentPath: `/${year}/`, itemName: day, itemType: 'album', published: true }));
            for (let i = 0; i < 20; i++) {
                const w = words[(y + d + i) % words.length];
                stmts.push(
                    upsertItem(env.DB, {
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
            await env.DB.batch(stmts.slice(i, i + 400));
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

    await env.MEDIA.put(`originals${galleryPath}/${versionId}`, bytes, { httpMetadata: obj.httpMetadata });
    await upsertItem(env.DB, {
        parentPath,
        itemName,
        itemType: /\.(mp4|mov|m4v|avi)$/i.test(itemName) ? 'video' : 'image',
        title,
        description,
        versionId,
        published: false,
    }).run();
    await env.MEDIA.delete(key);
    console.info({ event: 'upload_processed', galleryPath, versionId, title, description, eventTime: event.eventTime });
}

function tagText(tag: unknown): string | undefined {
    const d = (tag as { description?: unknown } | undefined)?.description;
    return typeof d === 'string' && d.trim() ? d.trim() : undefined;
}

/**
 * /i/<path>/<versionId>?size=200x200&crop=x,y,w,h — generated once with the Images binding, stored in R2,
 * served from R2 afterwards. Mirrors generateDerivedImage's crop-then-cover semantics.
 */
async function derivedImage(env: Env, url: URL): Promise<Response> {
    const rest = url.pathname.slice('/i'.length); // "/2024/06-15/photo.jpg/<versionId>"
    const size = url.searchParams.get('size') ?? '1024';
    const crop = url.searchParams.get('crop');
    const format = (url.searchParams.get('format') ?? 'image/jpeg') as ImageOutputOptions['format'];
    const derivedKey = `derived${rest}/${size}${crop ? `-${crop}` : ''}-${format.split('/')[1]}`;
    const headers = { 'cache-control': 'public, max-age=31536000, immutable' };

    const stored = await env.MEDIA.get(derivedKey);
    if (stored) {
        return new Response(stored.body, {
            headers: { ...headers, 'content-type': format, 'x-derived': 'stored' },
        });
    }

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
    await env.MEDIA.put(derivedKey, bytes, { httpMetadata: { contentType: format } });
    return new Response(bytes, { headers: { ...headers, 'content-type': format, 'x-derived': 'generated' } });
}

/** Nightly dump of the canonical table to R2; the FTS index is derived data and is rebuilt on restore. */
async function backupDatabase(env: Env): Promise<{ key: string; rows: number }> {
    const rows: Record<string, unknown>[] = [];
    let cursor: [string, string] = ['', ''];
    for (;;) {
        const page = await env.DB.prepare(
            `SELECT * FROM item WHERE (parent_path, item_name) > (?1, ?2)
             ORDER BY parent_path, item_name LIMIT 5000`,
        )
            .bind(...cursor)
            .run();
        rows.push(...page.results);
        if (page.results.length < 5000) break;
        const last = page.results.at(-1)!;
        cursor = [String(last.parent_path), String(last.item_name)];
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
