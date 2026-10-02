import { readFile } from 'node:fs/promises';
import {
    type AlbumGalleryItem,
    type ItemWrite,
    extensionOf,
    parentPathOf,
    parseAlbum,
    parsePresigned,
} from '@tacocat-gallery/shared';
import { adminCookie } from '@tacocat-gallery/api/test/secrets';

// The Worker's own API, called from Node as the test admin, for writing what a test starts from.

interface AdminRequest {
    method?: string;
    body?: BodyInit;
    headers?: Record<string, string>;
}

async function adminFetch(origin: string, path: string, { headers, ...init }: AdminRequest = {}): Promise<Response> {
    return fetch(new URL(path, origin), { ...init, headers: { ...headers, cookie: await adminCookie() } });
}

async function ensureOk(response: Response, what: string): Promise<Response> {
    if (!response.ok) {
        throw new Error(`${what} failed: ${response.status} ${await response.text()}`);
    }
    return response;
}

export async function readAlbum(origin: string, path: string): Promise<AlbumGalleryItem> {
    const response = await ensureOk(await adminFetch(origin, `/api/album${path}`), `reading ${path}`);
    return parseAlbum(await response.json());
}

export async function putItem(origin: string, item: ItemWrite): Promise<void> {
    await ensureOk(
        await adminFetch(origin, '/api/item', { method: 'PUT', body: JSON.stringify(item) }),
        `writing ${item.parentPath}${item.itemName}`,
    );
}

/** Makes a published album at `path`, answering false when there is one already, which the Worker refuses to remake. */
export async function createPublishedAlbum(origin: string, path: string): Promise<boolean> {
    const response = await adminFetch(origin, `/api/album${path}`, {
        method: 'PUT',
        body: JSON.stringify({ published: true }),
    });
    if (response.status === 400 && (await response.clone().text()).includes('already exists')) {
        return false;
    }
    await ensureOk(response, `creating ${path}`);
    return true;
}

export async function setThumbnail(origin: string, albumPath: string, mediaPath: string): Promise<void> {
    await ensureOk(
        await adminFetch(origin, `/api/album-thumb${albumPath}`, {
            method: 'PATCH',
            body: JSON.stringify({ mediaPath }),
        }),
        `setting ${albumPath}'s thumbnail`,
    );
}

/**
 * Uploads `file` to become the media item at `path`, as the app does under `UPLOAD_MODE=local`: a presigned URL, a PUT
 * to it, then word to the Worker that it arrived. The item is there once the pipeline has run, which this does not wait for.
 */
export async function uploadFile(origin: string, path: string, file: string): Promise<void> {
    const presigned = await ensureOk(
        await adminFetch(origin, `/api/presigned${parentPathOf(path)}`, {
            method: 'POST',
            body: JSON.stringify([{ path, extension: extensionOf(file) }]),
        }),
        `presigning ${path}`,
    );
    const upload = parsePresigned(await presigned.json())[path];
    if (upload === undefined) {
        throw new Error(`no upload URL for ${path}`);
    }
    await ensureOk(
        await adminFetch(origin, upload.url, {
            method: 'PUT',
            headers: { 'content-type': upload.contentType },
            body: await readFile(file),
        }),
        `uploading ${path}`,
    );
    await ensureOk(
        await adminFetch(origin, `/api/uploaded/${upload.versionId}`, { method: 'POST' }),
        `announcing ${path}`,
    );
}
