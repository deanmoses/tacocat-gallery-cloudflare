import {
    generateAuthenticationOptions,
    generateRegistrationOptions,
    verifyAuthenticationResponse,
    verifyRegistrationResponse,
    type AuthenticationResponseJSON,
    type AuthenticatorTransport,
    type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { db, schema } from './db';

export interface AuthEnv {
    DB: D1Database;
    SESSION_SECRET: string;
}

const SESSION_COOKIE = 'admin_session';
const CHALLENGE_COOKIE = 'pk_challenge';
const SESSION_DAYS = 30;
const NOW = sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

// A passkey is bound to the site it was created on. The browser's Origin header names that site, and only these
// are accepted; wrangler dev rewrites request.url to the custom domain, so the URL can't be used for this.
const ALLOWED_ORIGINS = [
    'https://tacocat-gallery-cloudflare.tacocat-gallery-cloudflare.workers.dev',
    'https://pix.deanmoses.com',
    'http://localhost:8787',
];

/** The two screens and the JSON endpoints behind them, or undefined if the request is not an auth route. */
export async function routeAuth(request: Request, env: AuthEnv, url: URL): Promise<Response | undefined> {
    const { pathname } = url;
    if (pathname === '/login') return html(LOGIN_PAGE);
    if (pathname.startsWith('/invite/')) return html(INVITE_PAGE);
    if (!pathname.startsWith('/api/auth/')) return undefined;
    if (request.method === 'GET' && pathname === '/api/auth/status') {
        return json({ admin: await currentAdmin(request, env) });
    }
    if (request.method !== 'POST') return json({ error: 'not found' }, 404);
    const origin = request.headers.get('origin') ?? '';
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'origin not allowed' }, 403);
    const site = new URL(origin);
    switch (pathname) {
        case '/api/auth/register/options':
            return registerOptions(request, env, site);
        case '/api/auth/register/verify':
            return registerVerify(request, env, site);
        case '/api/auth/login/options':
            return loginOptions(env, site);
        case '/api/auth/login/verify':
            return loginVerify(request, env, site);
        case '/api/auth/logout':
            return json({ admin: null }, 200, { 'set-cookie': cookie(SESSION_COOKIE, '', 0, '/') });
    }
    return json({ error: 'not found' }, 404);
}

/** The logged-in admin's name, or null for a guest. */
export async function currentAdmin(request: Request, env: AuthEnv): Promise<string | null> {
    const value = readCookie(request, SESSION_COOKIE);
    const payload = value && (await unsign(env, value));
    if (!payload) return null;
    const { name, exp } = JSON.parse(payload) as { name: string; exp: number };
    return exp > Date.now() ? name : null;
}

async function registerOptions(request: Request, env: AuthEnv, url: URL): Promise<Response> {
    const { token } = (await request.json()) as { token: string };
    const invite = await findInvite(env, token);
    if (!invite) return json({ error: 'This invite link is invalid, used or expired.' }, 400);
    const { adminPasskey } = schema;
    const existing = await db(env.DB)
        .select({ id: adminPasskey.credentialId, transports: adminPasskey.transports })
        .from(adminPasskey)
        .where(eq(adminPasskey.adminName, invite.adminName))
        .all();
    const options = await generateRegistrationOptions({
        rpName: 'Tacocat Gallery',
        rpID: url.hostname,
        userName: invite.adminName,
        // Stable per admin, so a new passkey from the same password manager replaces the old one there.
        userID: new Uint8Array(await sha256(`admin:${invite.adminName}`)).slice(0, 16),
        attestationType: 'none',
        excludeCredentials: existing.map((c) => ({
            id: c.id,
            transports: (c.transports as AuthenticatorTransport[] | null) ?? undefined,
        })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    return json(options, 200, { 'set-cookie': await challengeCookie(env, options.challenge) });
}

async function registerVerify(request: Request, env: AuthEnv, url: URL): Promise<Response> {
    const { token, response } = (await request.json()) as { token: string; response: RegistrationResponseJSON };
    const expectedChallenge = await readChallenge(request, env);
    if (!expectedChallenge) return json({ error: 'Login attempt expired; try again.' }, 400);
    const invite = await findInvite(env, token);
    if (!invite) return json({ error: 'This invite link is invalid, used or expired.' }, 400);

    const result = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: url.origin,
        expectedRPID: url.hostname,
        requireUserVerification: false,
    });
    if (!result.verified) return json({ error: 'Passkey could not be verified.' }, 400);

    // Claiming the invite first means a link used twice at once still yields one passkey.
    const { adminInvite, adminPasskey } = schema;
    const claimed = await db(env.DB)
        .update(adminInvite)
        .set({ usedAt: NOW })
        .where(and(eq(adminInvite.tokenHash, invite.tokenHash), isNull(adminInvite.usedAt)))
        .run();
    if (claimed.meta.changes !== 1) return json({ error: 'This invite link has already been used.' }, 400);

    const { credential } = result.registrationInfo;
    await db(env.DB).insert(adminPasskey).values({
        credentialId: credential.id,
        adminName: invite.adminName,
        publicKey: toBase64Url(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports,
    });
    console.info({ event: 'passkey_registered', admin: invite.adminName });
    return loggedIn(env, invite.adminName);
}

async function loginOptions(env: AuthEnv, url: URL): Promise<Response> {
    const options = await generateAuthenticationOptions({ rpID: url.hostname, userVerification: 'preferred' });
    return json(options, 200, { 'set-cookie': await challengeCookie(env, options.challenge) });
}

async function loginVerify(request: Request, env: AuthEnv, url: URL): Promise<Response> {
    const response = (await request.json()) as AuthenticationResponseJSON;
    const expectedChallenge = await readChallenge(request, env);
    if (!expectedChallenge) return json({ error: 'Login attempt expired; try again.' }, 400);
    const { adminPasskey } = schema;
    const passkey = await db(env.DB).select().from(adminPasskey).where(eq(adminPasskey.credentialId, response.id)).get();
    if (!passkey) return json({ error: 'This passkey is not registered here.' }, 401);

    const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: url.origin,
        expectedRPID: url.hostname,
        requireUserVerification: false,
        credential: {
            id: response.id,
            publicKey: fromBase64Url(passkey.publicKey),
            counter: passkey.counter,
            transports: (passkey.transports as AuthenticatorTransport[] | null) ?? undefined,
        },
    });
    if (!result.verified) return json({ error: 'Passkey could not be verified.' }, 401);
    await db(env.DB)
        .update(adminPasskey)
        .set({ counter: result.authenticationInfo.newCounter, lastUsedAt: NOW })
        .where(eq(adminPasskey.credentialId, response.id));
    console.info({ event: 'admin_logged_in', admin: passkey.adminName });
    return loggedIn(env, passkey.adminName);
}

async function loggedIn(env: AuthEnv, name: string): Promise<Response> {
    const maxAge = SESSION_DAYS * 86_400;
    const session = await sign(env, JSON.stringify({ name, exp: Date.now() + maxAge * 1000 }));
    const headers = new Headers({ 'content-type': 'application/json' });
    headers.append('set-cookie', cookie(SESSION_COOKIE, session, maxAge, '/'));
    headers.append('set-cookie', cookie(CHALLENGE_COOKIE, '', 0, '/api/auth/'));
    return new Response(JSON.stringify({ admin: name }), { headers });
}

async function findInvite(env: AuthEnv, token: string) {
    if (!token) return null;
    const { adminInvite } = schema;
    const invite = await db(env.DB)
        .select({ tokenHash: adminInvite.tokenHash, adminName: adminInvite.adminName })
        .from(adminInvite)
        .where(
            and(eq(adminInvite.tokenHash, toHex(await sha256(token))), isNull(adminInvite.usedAt), gt(adminInvite.expiresAt, NOW)),
        )
        .get();
    return invite ?? null;
}

async function challengeCookie(env: AuthEnv, challenge: string): Promise<string> {
    const value = await sign(env, JSON.stringify({ challenge, exp: Date.now() + 5 * 60_000 }));
    return cookie(CHALLENGE_COOKIE, value, 300, '/api/auth/', 'Strict');
}

async function readChallenge(request: Request, env: AuthEnv): Promise<string | null> {
    const value = readCookie(request, CHALLENGE_COOKIE);
    const payload = value && (await unsign(env, value));
    if (!payload) return null;
    const { challenge, exp } = JSON.parse(payload) as { challenge: string; exp: number };
    return exp > Date.now() ? challenge : null;
}

function cookie(name: string, value: string, maxAge: number, path: string, sameSite = 'Lax'): string {
    return `${name}=${value}; Max-Age=${maxAge}; Path=${path}; HttpOnly; Secure; SameSite=${sameSite}`;
}

function readCookie(request: Request, name: string): string | undefined {
    const header = request.headers.get('cookie') ?? '';
    for (const part of header.split(';')) {
        const [k, ...v] = part.trim().split('=');
        if (k === name) return v.join('=');
    }
    return undefined;
}

async function sign(env: AuthEnv, payload: string): Promise<string> {
    const body = toBase64Url(new TextEncoder().encode(payload));
    return `${body}.${toBase64Url(await hmac(env, body))}`;
}

async function unsign(env: AuthEnv, value: string): Promise<string | null> {
    const [body, sig] = value.split('.');
    if (!body || !sig) return null;
    const key = await hmacKey(env);
    const ok = await crypto.subtle.verify('HMAC', key, fromBase64Url(sig), new TextEncoder().encode(body));
    return ok ? new TextDecoder().decode(fromBase64Url(body)) : null;
}

async function hmac(env: AuthEnv, data: string): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(env), new TextEncoder().encode(data)));
}

function hmacKey(env: AuthEnv): Promise<CryptoKey> {
    if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is not set');
    return crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
        'verify',
    ]);
}

async function sha256(text: string): Promise<ArrayBuffer> {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
}

function toHex(buf: ArrayBuffer): string {
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
    const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function html(page: string): Response {
    return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

const PAGE_HEAD = `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>body{font:17px system-ui;margin:16px;max-width:480px}button{font:inherit;padding:10px 16px}#msg{margin-top:16px}</style>`;

const BROWSER_LIB = 'https://cdn.jsdelivr.net/npm/@simplewebauthn/browser@14.0.0/+esm';

const LOGIN_PAGE = `${PAGE_HEAD}
<title>Log in</title>
<h1>Tacocat admin</h1>
<p id="guest" hidden><button id="login">Log in with passkey</button></p>
<p id="admin" hidden>Logged in as <b id="name"></b>. <button id="logout">Log out</button></p>
<p id="msg"></p>
<script type="module">
import { startAuthentication } from '${BROWSER_LIB}';
const $ = (id) => document.getElementById(id);
const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
function show(admin) {
    $('guest').hidden = !!admin;
    $('admin').hidden = !admin;
    $('name').textContent = admin ?? '';
}
show((await (await fetch('/api/auth/status')).json()).admin);
$('login').onclick = async () => {
    $('msg').textContent = '';
    try {
        const optionsJSON = await (await post('/api/auth/login/options')).json();
        const res = await post('/api/auth/login/verify', await startAuthentication({ optionsJSON }));
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        show(body.admin);
    } catch (e) {
        $('msg').textContent = e.message;
    }
};
$('logout').onclick = async () => show((await (await post('/api/auth/logout')).json()).admin);
</script>`;

const INVITE_PAGE = `${PAGE_HEAD}
<title>Create passkey</title>
<h1>Tacocat admin</h1>
<p>Create a passkey to log in to the gallery as an admin. Your device will ask for Face ID, Touch ID or your password manager.</p>
<p><button id="create">Create passkey</button></p>
<p id="msg"></p>
<script type="module">
import { startRegistration } from '${BROWSER_LIB}';
const $ = (id) => document.getElementById(id);
const token = location.pathname.split('/').pop();
const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
$('create').onclick = async () => {
    $('msg').textContent = '';
    try {
        const options = await post('/api/auth/register/options', { token });
        const optionsJSON = await options.json();
        if (!options.ok) throw new Error(optionsJSON.error);
        const res = await post('/api/auth/register/verify', { token, response: await startRegistration({ optionsJSON }) });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        $('create').hidden = true;
        $('msg').innerHTML = 'Done. You are logged in as <b></b>. Next time, log in at <a href="/login">/login</a>.';
        $('msg').querySelector('b').textContent = body.admin;
    } catch (e) {
        $('msg').textContent = e.message;
    }
};
</script>`;
