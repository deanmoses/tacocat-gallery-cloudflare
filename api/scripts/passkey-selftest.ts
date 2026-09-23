// Drives the passkey flow end to end with a software authenticator, so it can be checked without a browser.
// Usage: node api/scripts/passkey-selftest.ts <invite url from api/scripts/invite.sh>
import * as valibot from 'valibot';
import { SoftwareAuthenticator } from '../test/authenticator.ts';

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

const inviteUrl = new URL(process.argv[2] ?? '');
const { origin } = inviteUrl;
const token = inviteUrl.pathname.split('/').pop();
let cookies = new Map<string, string>();

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
    // A write answers 204 with no body.
    const json = valibot.parse(API_BODY, response.status === 204 ? {} : await response.json());
    return { status: response.status, body: json, authStatus: response.headers.get('x-auth-status') };
}

function check(label: string, isOk: boolean, detail?: unknown): void {
    console.log(`${isOk ? 'PASS' : 'FAIL'} ${label}${isOk ? '' : ` ${JSON.stringify(detail)}`}`);
    if (!isOk) {
        process.exitCode = 1;
    }
}

const authenticator = await SoftwareAuthenticator.create();

// Writes before login are refused.
const guestWrite = await call('/api/item', {});
check('write refused as guest', guestWrite.status === 401);

// Registration through the invite.
const { body: registrationOptions } = await call('/api/auth/register/options', { token });
check('register options', registrationOptions.challenge !== undefined, registrationOptions);
const registration = await call('/api/auth/register/verify', {
    token,
    response: await authenticator.register(origin, registrationOptions.challenge ?? ''),
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
const assertion = await authenticator.assert(origin, loginOptions.challenge ?? '', registrationOptions.user?.id);
const login = await call('/api/auth/login/verify', assertion);
check('login', login.status === 200 && login.body.admin === admin, login);
const status = await call('/api/auth/status', undefined, 'GET');
check('status reports admin', status.body.admin === admin && status.authStatus === 'admin', status);
const write = await call('/api/item', {
    parentPath: '/selftest/',
    itemName: 'x',
    itemType: 'media',
    mediaType: 'image',
});
check('write allowed as admin', write.status === 204);

// Login needs the challenge cookie from its own options call, which login clears.
const replay = await call('/api/auth/login/verify', assertion);
check('login without a fresh challenge refused', replay.status !== 200);

const [body = '', signature = ''] = (cookies.get('admin_session') ?? '').split('.', 2);
const flipped = signature.slice(0, 10) + (signature[10] === 'A' ? 'B' : 'A') + signature.slice(11);
cookies = new Map([['admin_session', `${body}.${flipped}`]]);
const tampered = await call('/api/auth/status', undefined, 'GET');
check('tampered session refused', tampered.body.admin === null);
