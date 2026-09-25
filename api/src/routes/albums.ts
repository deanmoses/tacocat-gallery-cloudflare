import {
    type AlbumGalleryItem,
    albumKey,
    isAlbumPath,
    mediaKey,
    mediaPath,
    setThumbnailSchema,
} from 'tacocat-gallery-shared';
import * as valibot from 'valibot';
import { currentAdmin } from '../auth/passkeys';
import { orm } from '../db';
import { d1Header } from '../db/timing';
import { readAlbum, setThumbnail } from '../gallery/albums';
import { BOOKMARK_HEADER, requestBookmark, written } from '../http/bookmark';
import { pathAfter } from '../http/paths';
import { failure, json, notFound } from '../http/responses';

/**
 * Reads through the Sessions API so a nearby replica can answer. A client that just wrote passes the bookmark it got
 * back, which guarantees it reads its own write; ?consistency=primary forces the primary.
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
    const read = await readAlbum(orm(session), path, admin);
    if (read.album === null) {
        return notFound();
    }
    return json(read.album satisfies AlbumGalleryItem, 200, {
        [BOOKMARK_HEADER]: session.getBookmark() ?? '',
        'x-d1': d1Header(read.meta, read.d1Ms, read.rowsRead),
        // What one browser sees just after its own write is no answer for anyone else.
        ...(bookmark !== null && { 'cache-control': 'private, no-store' }),
    });
}

/**
 * `POST /api/album/<path>/thumbnail` with `{ path }` of a media item makes that the album's thumbnail. The album is
 * read afresh with the bookmark the answer carries.
 */
export async function setAlbumThumbnail(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = `/${pathAfter(url, '/api/album/').slice(0, -'thumbnail'.length)}`;
    if (!isAlbumPath(path)) {
        return notFound();
    }
    const album = albumKey(path);
    if (album === null) {
        return failure(400, 'the root album has no thumbnail');
    }
    const body = valibot.safeParse(setThumbnailSchema, await request.json());
    const media = body.success ? mediaKey(body.output.path) : null;
    if (media === null) {
        return failure(400, 'expected { path } of a media item, such as /2001/06-15/felix.jpg');
    }
    const session = env.DB.withSession('first-primary');
    const started = performance.now();
    const set = await setThumbnail(orm(session), album, media).run();
    return set.meta.changes === 0
        ? notFound(`No album ${path} with media ${mediaPath(media.parentPath, media.itemName)}`)
        : written(session, { 'x-d1': d1Header(set.meta, performance.now() - started) });
}

function withTrailingSlash(path: string): string {
    return path.endsWith('/') ? path : `${path}/`;
}
