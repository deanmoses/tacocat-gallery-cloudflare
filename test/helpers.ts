import { env, exports } from 'cloudflare:workers';

export const ORIGIN = 'http://localhost:8787';

const ENCODER = new TextEncoder();
const BASE64URL = { alphabet: 'base64url', omitPadding: true } as const;

/** Sends a request to the Worker under test, as a browser on the local dev origin would. */
export async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(path, ORIGIN);
    return exports.default.fetch(new Request(url, init));
}

/** Sends a request and reads the JSON body, typed as the caller expects it. */
export async function callForJson<T>(path: string, init: RequestInit = {}): Promise<T> {
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
export async function callAsAdmin(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('cookie', await adminCookie());
    return call(path, { ...init, headers });
}
