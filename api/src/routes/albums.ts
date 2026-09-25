import {
    type AlbumGalleryItem,
    type ItemKey,
    albumKey,
    albumPath,
    albumThumbnailSchema,
    albumWriteSchema,
    isAlbumPath,
    isDayName,
    mediaKey,
    renameSchema,
} from 'tacocat-gallery-shared';
import * as valibot from 'valibot';
import { currentAdmin } from '../auth/passkeys';
import { orm } from '../db';
import { d1Header, round } from '../db/timing';
import {
    type Written,
    albumExists,
    createAlbum,
    deleteAlbum,
    describeAlbum,
    mediaExists,
    readAlbum,
    renameAlbum,
    setThumbnail,
    updateAlbum,
} from '../gallery/albums';
import { BOOKMARK_HEADER, requestBookmark, written } from '../http/bookmark';
import { pathAfter } from '../http/paths';
import { failure, json, notFound } from '../http/responses';

/**
 * Reads through the Sessions API so a nearby replica can answer. A client that just wrote passes the bookmark it got
 * back, which guarantees it reads its own write; ?consistency=primary forces the primary. A HEAD, which the router
 * hands here as a GET, asks only whether the album is there for this caller.
 */
export async function getAlbum(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = withTrailingSlash(`/${pathAfter(url, '/api/album/')}`);
    if (!isAlbumPath(path)) {
        return notFound();
    }
    const admin = (await currentAdmin(request, env)) !== null;
    const bookmark = requestBookmark(request);
    const constraint =
        bookmark ?? (url.searchParams.get('consistency') === 'primary' ? 'first-primary' : 'first-unconstrained');
    const session = env.DB.withSession(constraint);
    if (request.method === 'HEAD') {
        return existence(await albumExists(orm(session), path, admin));
    }
    const read = await readAlbum(orm(session), path, admin);
    if (read.album === null) {
        return notFound();
    }
    // Browser runs record only what reaches the browser, so this is where an album read is matched to the D1 copy
    // that answered it.
    console.info({
        event: 'album_read',
        colo: request.cf?.colo,
        path,
        bookmark: bookmark !== null,
        d1Region: read.meta.served_by_region,
        d1Colo: read.meta.served_by_colo,
        d1Primary: read.meta.served_by_primary,
        d1Ms: round(read.d1Ms),
        rows: read.rowsRead,
    });
    return json(read.album satisfies AlbumGalleryItem, 200, {
        [BOOKMARK_HEADER]: session.getBookmark() ?? '',
        'x-d1': d1Header(read.meta, read.d1Ms, read.rowsRead),
        // What one browser sees just after its own write is no answer for anyone else.
        ...(bookmark !== null && { 'cache-control': 'private, no-store' }),
    });
}

/** The album an admin write names, or the answer for a path that is no album or is the root, which has no row. */
function writableAlbum(request: Request, prefix: string, verb: string): ItemKey | Response {
    const path = withTrailingSlash(`/${pathAfter(new URL(request.url), prefix)}`);
    if (!isAlbumPath(path)) {
        return notFound();
    }
    const key = albumKey(path);
    return key ?? failure(400, `Cannot ${verb} the root album`);
}

/** The body as `shape`, or the 400 for one that is not; nothing at all is an empty body. */
async function parsedBody<T extends valibot.GenericSchema>(
    request: Request,
    shape: T,
): Promise<{ output: valibot.InferOutput<T> } | { response: Response }> {
    const text = await request.text();
    const parsed = valibot.safeParse(shape, text.trim() === '' ? {} : parseJson(text));
    return parsed.success ? { output: parsed.output } : { response: failure(400, valibot.summarize(parsed.issues)) };
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

/** The bookmark to read the write back with, and what it cost. */
function wrote(session: D1DatabaseSession, write: Written, started: number): Response {
    return written(session, write.meta === null ? {} : { 'x-d1': d1Header(write.meta, performance.now() - started) });
}

/** `PUT /api/album/<path>` makes a year or day album, with whatever of its fields the body holds. */
export async function createAlbumRoute(request: Request, env: Env): Promise<Response> {
    const key = writableAlbum(request, '/api/album/', 'create');
    if (key instanceof Response) {
        return key;
    }
    const body = await parsedBody(request, albumWriteSchema);
    if ('response' in body) {
        return body.response;
    }
    const session = env.DB.withSession('first-primary');
    const started = performance.now();
    const write = await createAlbum(orm(session), key, body.output);
    return write.changes === 0
        ? failure(400, `Album already exists: [${albumPath(key.parentPath, key.itemName)}]`)
        : wrote(session, write, started);
}

/** `PATCH /api/album/<path>` changes the fields the body holds; a day album is published only under a published year. */
export async function updateAlbumRoute(request: Request, env: Env): Promise<Response> {
    const key = writableAlbum(request, '/api/album/', 'update');
    if (key instanceof Response) {
        return key;
    }
    const body = await parsedBody(request, albumWriteSchema);
    if ('response' in body) {
        return body.response;
    }
    if (Object.keys(body.output).length === 0) {
        return failure(400, 'No attributes to update');
    }
    const session = env.DB.withSession('first-primary');
    const started = performance.now();
    const write = await updateAlbum(orm(session), key, body.output);
    if (write.changes > 0) {
        return wrote(session, write, started);
    }
    const facts = await describeAlbum(orm(session), key);
    return facts.exists
        ? failure(400, 'Cannot publish until parent is published')
        : notFound(`Album not found: [${albumPath(key.parentPath, key.itemName)}]`);
}

/** `DELETE /api/album/<path>` removes an empty album. */
export async function deleteAlbumRoute(request: Request, env: Env): Promise<Response> {
    const key = writableAlbum(request, '/api/album/', 'delete');
    if (key instanceof Response) {
        return key;
    }
    const path = albumPath(key.parentPath, key.itemName);
    const session = env.DB.withSession('first-primary');
    const started = performance.now();
    const write = await deleteAlbum(orm(session), key);
    if (write.changes > 0) {
        return wrote(session, write, started);
    }
    const facts = await describeAlbum(orm(session), key);
    return facts.exists
        ? failure(400, `Album [${path}] contains child photos or child albums, and thus cannot be deleted.`)
        : notFound(`Album not found: [${path}]`);
}

/** `POST /api/album-rename/<path>` with `{ newName }` renames a day album within its year, and everything in it with it. */
export async function renameAlbumRoute(request: Request, env: Env): Promise<Response> {
    const key = writableAlbum(request, '/api/album-rename/', 'rename');
    if (key instanceof Response) {
        return key;
    }
    const path = albumPath(key.parentPath, key.itemName);
    if (key.parentPath === '/') {
        return failure(400, 'Cannot rename year albums');
    }
    const body = await parsedBody(request, renameSchema);
    if ('response' in body) {
        return body.response;
    }
    const { newName } = body.output;
    if (!isDayName(newName)) {
        return failure(400, `New name for album is invalid: [${newName}]`);
    }
    if (newName === key.itemName) {
        return failure(400, `New album [${path}] cannot be same as old [${path}]`);
    }
    const session = env.DB.withSession('first-primary');
    const started = performance.now();
    const write = await renameAlbum(orm(session), key, newName);
    if (write.changes > 0) {
        return wrote(session, write, started);
    }
    const facts = await describeAlbum(orm(session), key, { newName });
    return facts.taken
        ? failure(400, `Album already exists [${albumPath(key.parentPath, newName)}]`)
        : notFound(`Album not found [${path}]`);
}

/** `PATCH /api/album-thumb/<path>` with `{ mediaPath }` of a media item in the album, or an album in it, makes that its thumbnail. */
export async function setAlbumThumbnail(request: Request, env: Env): Promise<Response> {
    const key = writableAlbum(request, '/api/album-thumb/', 'set a thumbnail on');
    if (key instanceof Response) {
        return key;
    }
    const path = albumPath(key.parentPath, key.itemName);
    const body = await parsedBody(request, albumThumbnailSchema);
    if ('response' in body) {
        return body.response;
    }
    const media = mediaKey(body.output.mediaPath);
    if (media === null) {
        return failure(400, `Invalid media path: [${body.output.mediaPath}]`);
    }
    if (!media.parentPath.startsWith(path)) {
        return failure(400, `Media [${body.output.mediaPath}] is not in album [${path}]`);
    }
    const session = env.DB.withSession('first-primary');
    const started = performance.now();
    const set = await setThumbnail(orm(session), key, media).run();
    if (set.meta.changes > 0) {
        return wrote(session, { changes: set.meta.changes, meta: set.meta }, started);
    }
    const facts = await describeAlbum(orm(session), key, { mediaPath: body.output.mediaPath });
    return facts.exists
        ? failure(400, `Media not found: [${body.output.mediaPath}]`)
        : notFound(`Album not found: [${path}]`);
}

/** `HEAD /api/media/<path>`: whether the media item is there for this caller. There is nothing to GET. */
export async function headMedia(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'HEAD') {
        return failure(405, 'Method Not Allowed');
    }
    const key = mediaKey(`/${pathAfter(new URL(request.url), '/api/media/')}`);
    if (key === null) {
        return notFound();
    }
    const admin = (await currentAdmin(request, env)) !== null;
    const session = env.DB.withSession(requestBookmark(request) ?? 'first-unconstrained');
    return existence(await mediaExists(orm(session), key, admin));
}

/** 200 or 404 and no body, with what the lookup cost. */
function existence({ exists, meta }: { exists: boolean; meta: D1Meta | null }): Response {
    const headers = meta === null ? {} : { 'x-d1': d1Header(meta, 0) };
    return exists ? new Response(null, { status: 200, headers }) : notFound();
}

function withTrailingSlash(path: string): string {
    return path.endsWith('/') ? path : `${path}/`;
}
