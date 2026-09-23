// Drives the passkey flow end to end with a software authenticator, so it can be checked without a browser.
// Usage: node scripts/passkey-selftest.ts <invite url from scripts/invite.sh>
import { type CBORType, encodeCBOR } from '@levischuck/tiny-cbor';
import * as valibot from 'valibot';

/** The fields of the auth endpoints' JSON responses that this script reads. */
const TEXT = valibot.string();
const OPTIONAL_TEXT = valibot.optional(TEXT);
const USER = valibot.object({ id: TEXT });
const API_BODY = valibot.looseObject({
    // Null for a guest.
    admin: valibot.optional(valibot.nullable(TEXT)),
    challenge: OPTIONAL_TEXT,
    user: valibot.optional(USER),
    error: OPTIONAL_TEXT,
});

type ApiBody = valibot.InferOutput<typeof API_BODY>;

type Bytes = Uint8Array | readonly number[];

const encoder = new TextEncoder();

const inviteUrl = new URL(process.argv[2] ?? '');
const { origin } = inviteUrl;
const token = inviteUrl.pathname.split('/').pop();
const rpIdHash = await sha256(encoder.encode(inviteUrl.hostname));
let cookies = new Map<string, string>();

function base64url(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64url');
}

async function call(
    path: string,
    body?: unknown,
    method = 'POST',
): Promise<{ status: number; body: ApiBody; authStatus: string | null }> {
    const response = await fetch(origin + path, {
        method,
        headers: {
            'content-type': 'application/json',
            origin,
            cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    for (const header of response.headers.getSetCookie()) {
        const [pair = ''] = header.split(';', 1);
        const [name = '', value = ''] = pair.split('=', 2);
        if (value === '') {
            cookies.delete(name);
        } else {
            cookies.set(name, value);
        }
    }
    const json = valibot.parse(API_BODY, await response.json());
    return { status: response.status, body: json, authStatus: response.headers.get('x-auth-status') };
}

function check(label: string, isOk: boolean, detail?: unknown): void {
    console.log(`${isOk ? 'PASS' : 'FAIL'} ${label}${isOk ? '' : ` ${JSON.stringify(detail)}`}`);
    if (!isOk) {
        process.exitCode = 1;
    }
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

function concat(...parts: Bytes[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

// WebCrypto returns ECDSA signatures as r||s; WebAuthn wants ASN.1 DER.
function derSignature(raw: Uint8Array): Uint8Array {
    const integer = (bytes: Uint8Array): Uint8Array => {
        let start = 0;
        while (start < bytes.length - 1 && bytes[start] === 0) {
            start += 1;
        }
        const trimmed = bytes.slice(start);
        // A leading byte with the high bit set would read as negative, so it gets a zero byte in front.
        const isHighBitSet = (trimmed[0] ?? 0) >= 0x80;
        return concat(isHighBitSet ? [0x02, trimmed.length + 1, 0] : [0x02, trimmed.length], trimmed);
    };
    const body = concat(integer(raw.slice(0, 32)), integer(raw.slice(32)));
    return concat([0x30, body.length], body);
}

const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
const credentialId = crypto.getRandomValues(new Uint8Array(16));

// Writes before login are refused.
const guestWrite = await call('/api/item', {});
check('write refused as guest', guestWrite.status === 401);

// Registration through the invite.
const { body: registrationOptions } = await call('/api/auth/register/options', { token });
check('register options', registrationOptions.challenge !== undefined, registrationOptions);
const clientDataCreate = encoder.encode(
    JSON.stringify({ type: 'webauthn.create', challenge: registrationOptions.challenge, origin, crossOrigin: false }),
);
const coseKey = new Map<number, CBORType>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, new Uint8Array(Buffer.from(jwk.x ?? '', 'base64url'))],
    [-3, new Uint8Array(Buffer.from(jwk.y ?? '', 'base64url'))],
]);
// Flags 0x45: user present, user verified, attested credential data.
const registrationAuthData = concat(
    rpIdHash,
    [0x45],
    [0, 0, 0, 0],
    new Uint8Array(16),
    [0, credentialId.length],
    credentialId,
    new Uint8Array(encodeCBOR(coseKey)),
);
const attestation = new Map<string, CBORType>([
    ['fmt', 'none'],
    ['attStmt', new Map()],
    ['authData', registrationAuthData],
]);
const attestationObject = new Uint8Array(encodeCBOR(attestation));
const registration = await call('/api/auth/register/verify', {
    token,
    response: {
        id: base64url(credentialId),
        rawId: base64url(credentialId),
        type: 'public-key',
        response: {
            clientDataJSON: base64url(clientDataCreate),
            attestationObject: base64url(attestationObject),
            transports: ['internal'],
        },
        clientExtensionResults: {},
    },
});
const { admin } = registration.body;
check('register verify logs in', registration.status === 200 && typeof admin === 'string', registration);

const reuse = await call('/api/auth/register/options', { token });
check('invite cannot be reused', reuse.status === 400, reuse);

await call('/api/auth/logout', {});
const afterLogout = await call('/api/auth/status', undefined, 'GET');
check('logged out', afterLogout.body.admin === null);

// Login with the registered passkey.
const { body: loginOptions } = await call('/api/auth/login/options', {});
const clientDataGet = encoder.encode(
    JSON.stringify({ type: 'webauthn.get', challenge: loginOptions.challenge, origin, crossOrigin: false }),
);
const authData = concat(rpIdHash, [0x05], [0, 0, 0, 1]);
const signed = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keys.privateKey,
    concat(authData, await sha256(clientDataGet)),
);
const assertion = {
    id: base64url(credentialId),
    rawId: base64url(credentialId),
    type: 'public-key',
    response: {
        clientDataJSON: base64url(clientDataGet),
        authenticatorData: base64url(authData),
        signature: base64url(derSignature(new Uint8Array(signed))),
        userHandle: registrationOptions.user?.id,
    },
    clientExtensionResults: {},
};
const login = await call('/api/auth/login/verify', assertion);
check('login', login.status === 200 && login.body.admin === admin, login);
const status = await call('/api/auth/status', undefined, 'GET');
check('status reports admin', status.body.admin === admin && status.authStatus === 'admin', status);
const write = await call('/api/item', { parentPath: '/selftest/', itemName: 'x', itemType: 'image' });
check('write allowed as admin', write.status === 200);

// Login needs the challenge cookie from its own options call, which login clears.
const replay = await call('/api/auth/login/verify', assertion);
check('login without a fresh challenge refused', replay.status !== 200);

const [body = '', signature = ''] = (cookies.get('admin_session') ?? '').split('.', 2);
const flipped = signature.slice(0, 10) + (signature[10] === 'A' ? 'B' : 'A') + signature.slice(11);
cookies = new Map([['admin_session', `${body}.${flipped}`]]);
const tampered = await call('/api/auth/status', undefined, 'GET');
check('tampered session refused', tampered.body.admin === null);
