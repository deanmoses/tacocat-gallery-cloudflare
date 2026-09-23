// Drives the passkey flow end to end with a software authenticator, so it can be checked without a browser.
// Usage: node scripts/passkey-selftest.mjs <invite url from scripts/invite.sh>
import { encodeCBOR } from '@levischuck/tiny-cbor';

const inviteUrl = new URL(process.argv[2] ?? '');
const origin = inviteUrl.origin;
const token = inviteUrl.pathname.split('/').pop();
const rpIdHash = await sha256(new TextEncoder().encode(inviteUrl.hostname));
const b64url = (b) => Buffer.from(b).toString('base64url');
let cookies = {};

async function call(path, body, method = 'POST') {
    const res = await fetch(origin + path, {
        method,
        headers: {
            'content-type': 'application/json',
            origin,
            cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
        const [kv] = c.split(';');
        const [k, v] = kv.split('=');
        if (v) cookies[k] = v;
        else delete cookies[k];
    }
    return { status: res.status, body: await res.json(), authStatus: res.headers.get('x-auth-status') };
}

function check(label, ok, detail) {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ` ${JSON.stringify(detail)}`}`);
    if (!ok) process.exitCode = 1;
}

async function sha256(bytes) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

function concat(...parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let i = 0;
    for (const p of parts) out.set(p, (i += p.length) - p.length);
    return out;
}

// WebCrypto returns ECDSA signatures as r||s; WebAuthn wants ASN.1 DER.
function derSignature(raw) {
    const int = (b) => {
        let i = 0;
        while (i < b.length - 1 && b[i] === 0) i++;
        b = b.slice(i);
        return b[0] & 0x80 ? concat([0x02, b.length + 1, 0], b) : concat([0x02, b.length], b);
    };
    const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
    return concat([0x30, body.length], body);
}

const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
const credId = crypto.getRandomValues(new Uint8Array(16));

// Writes before login are refused.
check('write refused as guest', (await call('/api/item', {})).status === 401);

// Registration through the invite.
const regOptions = (await call('/api/auth/register/options', { token })).body;
check('register options', !!regOptions.challenge, regOptions);
const clientDataCreate = new TextEncoder().encode(
    JSON.stringify({ type: 'webauthn.create', challenge: regOptions.challenge, origin, crossOrigin: false }),
);
const coseKey = new Map([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))],
    [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))],
]);
const regAuthData = concat(
    rpIdHash,
    [0x45], // user present, user verified, attested credential data
    [0, 0, 0, 0],
    new Uint8Array(16),
    [0, credId.length],
    credId,
    new Uint8Array(encodeCBOR(coseKey)),
);
const attestationObject = new Uint8Array(
    encodeCBOR(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', regAuthData]])),
);
const reg = await call('/api/auth/register/verify', {
    token,
    response: {
        id: b64url(credId),
        rawId: b64url(credId),
        type: 'public-key',
        response: { clientDataJSON: b64url(clientDataCreate), attestationObject: b64url(attestationObject), transports: ['internal'] },
        clientExtensionResults: {},
    },
});
check('register verify logs in', reg.status === 200 && !!reg.body.admin, reg);
const admin = reg.body.admin;

const reuse = await call('/api/auth/register/options', { token });
check('invite cannot be reused', reuse.status === 400, reuse);

await call('/api/auth/logout', {});
check('logged out', (await call('/api/auth/status', undefined, 'GET')).body.admin === null);

// Login with the registered passkey.
const loginOptions = (await call('/api/auth/login/options', {})).body;
const clientDataGet = new TextEncoder().encode(
    JSON.stringify({ type: 'webauthn.get', challenge: loginOptions.challenge, origin, crossOrigin: false }),
);
const authData = concat(rpIdHash, [0x05], [0, 0, 0, 1]);
const signature = derSignature(
    new Uint8Array(
        await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, concat(authData, await sha256(clientDataGet))),
    ),
);
const assertion = {
    id: b64url(credId),
    rawId: b64url(credId),
    type: 'public-key',
    response: {
        clientDataJSON: b64url(clientDataGet),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        userHandle: regOptions.user.id,
    },
    clientExtensionResults: {},
};
const login = await call('/api/auth/login/verify', assertion);
check('login', login.status === 200 && login.body.admin === admin, login);
const status = await call('/api/auth/status', undefined, 'GET');
check('status reports admin', status.body.admin === admin && status.authStatus === 'admin', status);
check('write allowed as admin', (await call('/api/item', { parentPath: '/selftest/', itemName: 'x', itemType: 'image' })).status === 200);

// Login needs the challenge cookie from its own options call, which login clears.
check('login without a fresh challenge refused', (await call('/api/auth/login/verify', assertion)).status !== 200);

const saved = cookies;
const [body, sig] = saved.admin_session.split('.');
const flipped = sig.slice(0, 10) + (sig[10] === 'A' ? 'B' : 'A') + sig.slice(11);
cookies = { admin_session: `${body}.${flipped}` };
check('tampered session refused', (await call('/api/auth/status', undefined, 'GET')).body.admin === null);
