import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import worker from '../src/index';

export const ORIGIN = 'http://localhost:8787';

// What a request to the Worker can carry, typed as a request arriving at the edge, the only kind its handler accepts.
type Init = RequestInit<IncomingRequestCfProperties>;

const ENCODER = new TextEncoder();
const BASE64URL = { alphabet: 'base64url', omitPadding: true } as const;

/**
 * Sends a request to the Worker under test, as a browser on the local dev origin would, and waits for the work it left
 * running with waitUntil(), such as a cache write, so that the next test's reset() cannot pull storage out from under
 * it.
 */
export async function call(path: string, init: Init = {}): Promise<Response> {
    const request = new Request<unknown, IncomingRequestCfProperties>(new URL(path, ORIGIN), init);
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    return response;
}

/** Sends a request and reads the JSON body, typed as the caller expects it. */
export async function callForJson<T>(path: string, init: Init = {}): Promise<T> {
    const response = await call(path, init);
    return response.json<T>();
}

/**
 * A session cookie signed the way the Worker signs one, built independently of src/session.ts so a change to the
 * cookie format fails here.
 */
export async function adminCookie(name = 'Test Admin', expiresAt = Date.now() + 60_000): Promise<string> {
    const payload = ENCODER.encode(JSON.stringify({ name, exp: expiresAt }));
    const body = payload.toBase64(BASE64URL);
    const secret = ENCODER.encode(env.SESSION_SECRET);
    const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, ENCODER.encode(body)));
    return `admin_session=${body}.${signature.toBase64(BASE64URL)}`;
}

/** Sends a request with a valid admin session. */
export async function callAsAdmin(path: string, init: Init = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('cookie', await adminCookie());
    return call(path, { ...init, headers });
}

/** Saves an item as an admin through the write API. */
export async function putItem(item: Record<string, unknown>): Promise<Response> {
    return callAsAdmin('/api/item', { method: 'PUT', body: JSON.stringify(item) });
}
