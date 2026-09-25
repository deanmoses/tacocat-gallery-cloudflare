import {
    type ItemKey,
    cropPercentSchema,
    extensionOf,
    isStrictMediaName,
    mediaKey,
    mediaPath,
    mediaWriteSchema,
    renameSchema,
} from 'tacocat-gallery-shared';
import { currentAdmin } from '../auth/passkeys';
import { orm } from '../db';
import { d1Header } from '../db/timing';
import { mediaExists } from '../gallery/albums';
import { deleteMedia, describeMedia, recutThumbnail, renameMedia, updateMedia } from '../gallery/media';
import { requestBookmark } from '../http/bookmark';
import { pathAfter } from '../http/paths';
import { failure, notFound } from '../http/responses';
import { parsedBody, wrote } from './requests';

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
    const { exists, meta } = await mediaExists(orm(session), key, admin);
    const headers = meta === null ? {} : { 'x-d1': d1Header(meta, 0) };
    return exists ? new Response(null, { status: 200, headers }) : notFound();
}

/** The media item an admin write names, or the 404 for a path that is no media item. */
function writableMedia(request: Request, prefix: string): ItemKey | Response {
    return mediaKey(`/${pathAfter(new URL(request.url), prefix)}`) ?? notFound();
}

function notFoundMedia(key: ItemKey): Response {
    return notFound(`Media not found: [${mediaPath(key.parentPath, key.itemName)}]`);
}

/** `PATCH /api/media/<path>` changes the fields the body holds. */
export async function updateMediaRoute(request: Request, env: Env): Promise<Response> {
    const key = writableMedia(request, '/api/media/');
    if (key instanceof Response) {
        return key;
    }
    const body = await parsedBody(request, mediaWriteSchema);
    if ('response' in body) {
        return body.response;
    }
    if (Object.keys(body.output).length === 0) {
        return failure(400, 'No attributes to update');
    }
    const session = env.DB.withSession('first-primary');
    const started = performance.now();
    const write = await updateMedia(orm(session), key, body.output);
    return write.changes > 0 ? wrote(session, write, started) : notFoundMedia(key);
}

/** `DELETE /api/media/<path>` drops the item; its objects wait for the purge. */
export async function deleteMediaRoute(request: Request, env: Env): Promise<Response> {
    const key = writableMedia(request, '/api/media/');
    if (key instanceof Response) {
        return key;
    }
    const session = env.DB.withSession('first-primary');
    const started = performance.now();
    const write = await deleteMedia(orm(session), key);
    return write.changes > 0 ? wrote(session, write, started) : notFoundMedia(key);
}

/** `POST /api/media-rename/<path>` with `{ newName }`: a strict name with the extension the item has. */
export async function renameMediaRoute(request: Request, env: Env): Promise<Response> {
    const key = writableMedia(request, '/api/media-rename/');
    if (key instanceof Response) {
        return key;
    }
    const path = mediaPath(key.parentPath, key.itemName);
    const body = await parsedBody(request, renameSchema);
    if ('response' in body) {
        return body.response;
    }
    const { newName } = body.output;
    if (!isStrictMediaName(newName)) {
        return failure(400, `New media name is invalid: [${newName}]`);
    }
    if (newName === key.itemName) {
        return failure(400, `New media name [${newName}] cannot be same as old one [${path}]`);
    }
    if (extensionOf(newName) !== extensionOf(key.itemName)) {
        return failure(400, `New media name [${newName}] must keep the extension [.${extensionOf(key.itemName)}]`);
    }
    const session = env.DB.withSession('first-primary');
    const started = performance.now();
    const write = await renameMedia(orm(session), key, newName);
    if (write.changes > 0) {
        return wrote(session, write, started);
    }
    const facts = await describeMedia(orm(session), key, { newName });
    return facts.taken
        ? failure(400, `A media item already exists at [${mediaPath(key.parentPath, newName)}]`)
        : notFoundMedia(key);
}

/** `PATCH /api/thumb/<path>` with a rectangle in percent of the image sets where its thumbnail is cut from. */
export async function recutThumbnailRoute(request: Request, env: Env): Promise<Response> {
    const key = writableMedia(request, '/api/thumb/');
    if (key instanceof Response) {
        return key;
    }
    const body = await parsedBody(request, cropPercentSchema);
    if ('response' in body) {
        return body.response;
    }
    const session = env.DB.withSession('first-primary');
    const started = performance.now();
    const write = await recutThumbnail(orm(session), key, body.output);
    return write.changes > 0
        ? wrote(session, write, started)
        : notFound(`Image not found: [${mediaPath(key.parentPath, key.itemName)}]`);
}
