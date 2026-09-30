import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { type AlbumGalleryItem, type ItemWrite, parseAlbum } from '@tacocat-gallery/shared';
import { expect } from 'vitest';
import { orm, schema } from '../src/db';
import type { R2EventMessage } from '../src/gallery/upload';
import worker from '../src/index';
import { adminCookie } from './secrets';
import { withVersionId } from './version-id';

export const ORIGIN = 'http://localhost:8787';

/** The Worker through the platform's handler type, which passes the execution context the Worker's own methods ignore. */
export const handler: ExportedHandler<Env, R2EventMessage> = worker;

// What a request to the Worker can carry, typed as a request arriving at the edge, the only kind its handler accepts.
type Init = RequestInit<IncomingRequestCfProperties>;

/**
 * Sends a request to the Worker under test, as a browser on the local dev origin would, and waits for the work it left
 * running with waitUntil(), such as a cache write, so that the next test's reset() cannot pull storage out from under
 * it.
 */
export async function call(path: string, init: Init = {}, bindings: Partial<Env> = {}): Promise<Response> {
    const request = new Request<unknown, IncomingRequestCfProperties>(new URL(path, ORIGIN), init);
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, { ...env, ...bindings }, ctx);
    await waitOnExecutionContext(ctx);
    return response;
}

/** Sends a request and reads the JSON body, typed as the caller expects it. */
export async function callForJson<T>(path: string, init: Init = {}): Promise<T> {
    const response = await call(path, init);
    return response.json<T>();
}

/**
 * The response body parsed with `parse`, a schema's parse function from shared/, and checked to be exactly that type.
 * Parsing drops fields the schema lacks, so the body must equal what parsing leaves of it: a field the Worker sends but
 * the web app never sees fails here.
 */
export async function parseExactly<T>(response: Response, parse: (input: unknown) => T): Promise<T> {
    const body: unknown = await response.json();
    const parsed = parse(body);

    expect(body).toStrictEqual(parsed);

    return parsed;
}

/** Sends a request with a valid admin session. */
export async function callAsAdmin(path: string, init: Init = {}, bindings: Partial<Env> = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('cookie', await adminCookie());
    return call(path, { ...init, headers }, bindings);
}

/** Sends an admin write as the web app does, with a JSON body unless there is none. */
export async function write(method: string, path: string, body?: unknown, init: Init = {}): Promise<Response> {
    return callAsAdmin(path, { ...init, method, ...(body !== undefined && { body: JSON.stringify(body) }) });
}

/** The message an error response gives. */
export async function errorMessage(response: Response): Promise<string> {
    return (await response.json<{ errorMessage: string }>()).errorMessage;
}

/** The album at `path` as a guest sees it. */
export async function album(path: string): Promise<AlbumGalleryItem> {
    return parseExactly(await call(`/api/album${path}`), parseAlbum);
}

/** The album at `path` as an admin sees it, unpublished albums included. */
export async function albumAsAdmin(path: string): Promise<AlbumGalleryItem> {
    return parseExactly(await callAsAdmin(`/api/album${path}`), parseAlbum);
}

type MediaWrite = Extract<ItemWrite, { itemType: 'media' }>;

/** An item to save, whose version id media may leave out to be given one of its own. */
export type ItemFixture = Exclude<ItemWrite, MediaWrite> | (Omit<MediaWrite, 'versionId'> & { versionId?: string });

/** Saves an item as an admin through the write API. */
export async function putItem(item: ItemFixture): Promise<Response> {
    return callAsAdmin('/api/item', { method: 'PUT', body: JSON.stringify(withVersionId(item)) });
}

/** Saves the year and the day album of `dayPath`, such as `/2024/06-15/`. */
export async function putDay(dayPath: string, options: { published?: boolean } = {}): Promise<void> {
    const [, year = '', day = ''] = dayPath.split('/', 3);
    await putItem({ parentPath: '/', itemName: year, itemType: 'album', ...options });
    await putItem({ parentPath: `/${year}/`, itemName: day, itemType: 'album', ...options });
}

/** The item stored at `parentPath` under `itemName`, read straight from D1. */
export async function storedItem(parentPath: string, itemName: string): Promise<schema.Item | undefined> {
    const { item } = schema;
    return orm(env.DB)
        .select()
        .from(item)
        .where(and(eq(item.parentPath, parentPath), eq(item.itemName, itemName)))
        .get();
}
