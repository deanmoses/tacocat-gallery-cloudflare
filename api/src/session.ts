// Signed cookies: the admin session and the passkey challenge. Stateless, so a session cannot be revoked early;
// rotating SESSION_SECRET logs every admin out.

import * as valibot from 'valibot';

export type SessionEnv = Pick<Env, 'SESSION_SECRET'>;

/** A signed cookie: its name, and the shape of the payload it carries besides `exp`. */
export interface SignedCookie<TPayload extends valibot.GenericSchema> {
    name: string;
    payload: TPayload;
}

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
const TO_BASE64URL = { alphabet: 'base64url', omitPadding: true } as const;
const FROM_BASE64URL = { alphabet: 'base64url' } as const;

export function cookie(
    name: string,
    value: string,
    options: { maxAge: number; path: string; sameSite?: 'Lax' | 'Strict' },
): string {
    const attributes = [
        `Max-Age=${options.maxAge}`,
        `Path=${options.path}`,
        'HttpOnly',
        'Secure',
        `SameSite=${options.sameSite ?? 'Lax'}`,
    ];
    return [`${name}=${value}`, ...attributes].join('; ');
}

/** The payload of a cookie this Worker signed, if it is intact, has the expected shape and is not past its `exp`. */
export async function readSigned<TPayload extends valibot.GenericSchema>(
    request: Request,
    env: SessionEnv,
    signed: SignedCookie<TPayload>,
): Promise<valibot.InferOutput<TPayload> | null> {
    const value = readCookie(request, signed.name);
    const payload = value === undefined ? null : await unsign(env, value);
    if (payload === null) {
        return null;
    }
    const expiring = valibot.object({ exp: valibot.number() });
    const json: unknown = JSON.parse(payload);
    const expiry = valibot.safeParse(expiring, json);
    const parsed = valibot.safeParse(signed.payload, json);
    return expiry.success && parsed.success && expiry.output.exp > Date.now() ? parsed.output : null;
}

/** `payload` as JSON, base64url, then a dot and its HMAC-SHA256. */
export async function sign(env: SessionEnv, payload: { exp: number } & Record<string, unknown>): Promise<string> {
    const body = ENCODER.encode(JSON.stringify(payload)).toBase64(TO_BASE64URL);
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(env), ENCODER.encode(body)));
    return `${body}.${signature.toBase64(TO_BASE64URL)}`;
}

function readCookie(request: Request, name: string): string | undefined {
    const header = request.headers.get('cookie') ?? '';
    for (const part of header.split(';')) {
        const [key, ...value] = part.trim().split('=');
        if (key === name) {
            return value.join('=');
        }
    }
    return undefined;
}

async function unsign(env: SessionEnv, value: string): Promise<string | null> {
    const [body, signature] = value.split('.', 2);
    if (body === undefined || body === '' || signature === undefined || signature === '') {
        return null;
    }
    const decoded = decodeBase64Url(body);
    const signatureBytes = decodeBase64Url(signature);
    if (decoded === null || signatureBytes === null) {
        return null;
    }
    const isValid = await crypto.subtle.verify('HMAC', await hmacKey(env), signatureBytes, ENCODER.encode(body));
    return isValid ? DECODER.decode(decoded) : null;
}

/** The bytes, or null for anything that is not base64url and so was not signed here. */
function decodeBase64Url(text: string): Uint8Array | null {
    try {
        return Uint8Array.fromBase64(text, FROM_BASE64URL);
    } catch {
        return null;
    }
}

async function hmacKey(env: SessionEnv): Promise<CryptoKey> {
    if (env.SESSION_SECRET === '') {
        throw new Error('SESSION_SECRET is not set');
    }
    const secret = ENCODER.encode(env.SESSION_SECRET);
    return crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
