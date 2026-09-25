import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import type { ItemWrite } from 'tacocat-gallery-shared';
import { expect } from 'vitest';
import { orm, schema } from '../src/db';
import worker from '../src/index';
import { adminCookie } from './secrets';

export const ORIGIN = 'http://localhost:8787';

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

/** Saves an item as an admin through the write API. */
export async function putItem(item: ItemWrite): Promise<Response> {
    return callAsAdmin('/api/item', { method: 'PUT', body: JSON.stringify(item) });
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
