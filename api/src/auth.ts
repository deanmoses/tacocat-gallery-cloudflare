import {
    type AuthenticationResponseJSON,
    type RegistrationResponseJSON,
    generateAuthenticationOptions,
    generateRegistrationOptions,
    verifyAuthenticationResponse,
    verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import * as valibot from 'valibot';
import { type Orm, orm, schema } from './db';
import { html, json, notFound } from './http';
import { INVITE_PAGE, LOGIN_PAGE } from './pages/auth';
import { type SignedCookie, cookie, readSigned, sign } from './session';

type AuthEnv = Pick<Env, 'DB' | 'SESSION_SECRET' | 'SITE_ORIGIN'>;

const SESSION_COOKIE = 'admin_session';
const CHALLENGE_COOKIE = 'pk_challenge';
const SESSION = {
    name: SESSION_COOKIE,
    payload: valibot.object({ name: valibot.string() }),
} satisfies SignedCookie<valibot.GenericSchema>;
const CHALLENGE = {
    name: CHALLENGE_COOKIE,
    payload: valibot.object({ challenge: valibot.string() }),
} satisfies SignedCookie<valibot.GenericSchema>;
const SESSION_DAYS = 30;
const CHALLENGE_MS = 5 * 60_000;
const NOW = sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
const ENCODER = new TextEncoder();
const TO_BASE64URL = { alphabet: 'base64url', omitPadding: true } as const;
const FROM_BASE64URL = { alphabet: 'base64url' } as const;

// A passkey is bound to the site it was created on. The browser's Origin header names that site, and only the
// environment's own site and local development are accepted; wrangler dev rewrites request.url to the custom domain,
// so the URL can't be used for this.
function isAllowedOrigin(origin: string, env: AuthEnv): boolean {
    return origin === env.SITE_ORIGIN || origin === 'http://localhost:8787';
}

/** The two screens and the JSON endpoints behind them, or undefined if the request is not an auth route. */
export async function routeAuth(request: Request, env: AuthEnv): Promise<Response | undefined> {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname === '/login') {
        return html(LOGIN_PAGE);
    }
    if (pathname.startsWith('/invite/')) {
        return html(INVITE_PAGE);
    }
    if (!pathname.startsWith('/api/auth/')) {
        return undefined;
    }
    if (pathname === '/api/auth/status' && request.method === 'GET') {
        return json({ admin: await currentAdmin(request, env) });
    }
    if (request.method !== 'POST') {
        return notFound();
    }
    const origin = request.headers.get('origin') ?? '';
    if (!isAllowedOrigin(origin, env)) {
        return json({ error: 'origin not allowed' }, 403);
    }
    const site = new URL(origin);
    switch (pathname) {
        case '/api/auth/register/options': {
            return registerOptions(request, env, site);
        }
        case '/api/auth/register/verify': {
            return registerVerify(request, env, site);
        }
        case '/api/auth/login/options': {
            return loginOptions(env, site);
        }
        case '/api/auth/login/verify': {
            return loginVerify(request, env, site);
        }
        case '/api/auth/logout': {
            return json({ admin: null }, 200, { 'set-cookie': cookie(SESSION_COOKIE, '', { maxAge: 0, path: '/' }) });
        }
        default: {
            return notFound();
        }
    }
}

/** Records a login challenge as used, changing no row if it already was. */
export async function spendChallenge(database: Orm, challenge: string): Promise<D1Result> {
    const { spentChallenge } = schema;
    return database
        .insert(spentChallenge)
        .values({ challenge, expiresAt: new Date(Date.now() + CHALLENGE_MS).toISOString() })
        .onConflictDoNothing()
        .run();
}

/** Forgets spent challenges whose cookies have expired, and with them any chance of a replay. */
export async function purgeSpentChallenges(database: Orm): Promise<D1Result> {
    const { spentChallenge } = schema;
    const purged = await database
        .delete(spentChallenge)
        .where(lt(spentChallenge.expiresAt, new Date().toISOString()))
        .run();
    console.info({ event: 'spent_challenges_purged', rows: purged.meta.changes });
    return purged;
}

/** The logged-in admin's name, or null for a guest. */
export async function currentAdmin(request: Request, env: AuthEnv): Promise<string | null> {
    const session = await readSigned(request, env, SESSION);
    return session?.name ?? null;
}

async function registerOptions(request: Request, env: AuthEnv, site: URL): Promise<Response> {
    const { token } = await request.json<{ token: string }>();
    const invite = await findInvite(env, token);
    if (!invite) {
        return json({ error: 'This invite link is invalid, used or expired.' }, 400);
    }
    const existing = await orm(env.DB)
        .select({ id: schema.passkey.credentialId, transports: schema.passkey.transports })
        .from(schema.passkey)
        .where(eq(schema.passkey.username, invite.username))
        .all();
    const userId = await sha256(`admin:${invite.username}`);
    const options = await generateRegistrationOptions({
        rpName: 'Tacocat Gallery',
        rpID: site.hostname,
        userName: invite.username,
        // Stable per admin, so a new passkey from the same password manager replaces the old one there.
        userID: userId.slice(0, 16),
        attestationType: 'none',
        excludeCredentials: existing.map((credential) => ({
            id: credential.id,
            ...transportsOf(credential.transports),
        })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    return json(options, 200, { 'set-cookie': await challengeCookie(env, options.challenge) });
}

async function registerVerify(request: Request, env: AuthEnv, site: URL): Promise<Response> {
    const { token, response } = await request.json<{ token: string; response: RegistrationResponseJSON }>();
    const expectedChallenge = await readChallenge(request, env);
    if (expectedChallenge === null) {
        return json({ error: 'Login attempt expired; try again.' }, 400);
    }
    const invite = await findInvite(env, token);
    if (!invite) {
        return json({ error: 'This invite link is invalid, used or expired.' }, 400);
    }

    const result = await unlessThrown(
        verifyRegistrationResponse({
            response,
            expectedChallenge,
            expectedOrigin: site.origin,
            expectedRPID: site.hostname,
            requireUserVerification: false,
        }),
    );
    if (result?.verified !== true) {
        return json({ error: 'Passkey could not be verified.' }, 400);
    }

    // Claiming the invite first means a link used twice at once still yields one passkey.
    const claimed = await orm(env.DB)
        .update(schema.invite)
        .set({ usedAt: NOW })
        .where(and(eq(schema.invite.tokenHash, invite.tokenHash), isNull(schema.invite.usedAt)))
        .run();
    if (claimed.meta.changes !== 1) {
        return json({ error: 'This invite link has already been used.' }, 400);
    }

    const { credential } = result.registrationInfo;
    await orm(env.DB)
        .insert(schema.passkey)
        .values({
            credentialId: credential.id,
            username: invite.username,
            publicKey: credential.publicKey.toBase64(TO_BASE64URL),
            counter: credential.counter,
            transports: credential.transports ?? null,
        });
    console.info({ event: 'passkey_registered', admin: invite.username });
    return loggedIn(env, invite.username);
}

async function loginOptions(env: AuthEnv, site: URL): Promise<Response> {
    const options = await generateAuthenticationOptions({ rpID: site.hostname, userVerification: 'preferred' });
    return json(options, 200, { 'set-cookie': await challengeCookie(env, options.challenge) });
}

async function loginVerify(request: Request, env: AuthEnv, site: URL): Promise<Response> {
    const response = await request.json<AuthenticationResponseJSON>();
    const expectedChallenge = await readChallenge(request, env);
    if (expectedChallenge === null) {
        return json({ error: 'Login attempt expired; try again.' }, 400);
    }
    const passkey = await orm(env.DB)
        .select()
        .from(schema.passkey)
        .where(eq(schema.passkey.credentialId, response.id))
        .get();
    if (!passkey) {
        return json({ error: 'This passkey is not registered here.' }, 401);
    }

    const result = await unlessThrown(
        verifyAuthenticationResponse({
            response,
            expectedChallenge,
            expectedOrigin: site.origin,
            expectedRPID: site.hostname,
            requireUserVerification: false,
            credential: {
                id: response.id,
                publicKey: Uint8Array.fromBase64(passkey.publicKey, FROM_BASE64URL),
                counter: passkey.counter,
                ...transportsOf(passkey.transports),
            },
        }),
    );
    if (result?.verified !== true) {
        return json({ error: 'Passkey could not be verified.' }, 401);
    }
    // Only after verifying, so a request without a valid signature writes nothing.
    const spent = await spendChallenge(orm(env.DB), expectedChallenge);
    if (spent.meta.changes !== 1) {
        console.warn({ event: 'passkey_replayed', admin: passkey.username });
        return json({ error: 'Passkey could not be verified.' }, 401);
    }
    await orm(env.DB)
        .update(schema.passkey)
        .set({ counter: result.authenticationInfo.newCounter, lastUsedAt: NOW })
        .where(eq(schema.passkey.credentialId, response.id));
    console.info({ event: 'admin_logged_in', admin: passkey.username });
    return loggedIn(env, passkey.username);
}

/**
 * The verification's result, or null if SimpleWebAuthn threw, as it does for most mismatches: another challenge, origin
 * or RP ID, or a sign count that went backwards. Its messages name what the server expected, so they go to the log
 * rather than the response.
 */
async function unlessThrown<T>(verification: Promise<T>): Promise<T | null> {
    try {
        return await verification;
    } catch (error) {
        console.warn({ event: 'passkey_rejected', error: String(error) });
        return null;
    }
}

/** The stored transports, as the optional field SimpleWebAuthn takes: absent rather than null when unknown. */
function transportsOf(stored: string[] | null): { transports?: string[] } {
    return stored === null ? {} : { transports: stored };
}

async function loggedIn(env: AuthEnv, name: string): Promise<Response> {
    const maxAge = SESSION_DAYS * 86_400;
    const session = await sign(env, { name, exp: Date.now() + maxAge * 1000 });
    const headers = new Headers();
    headers.append('set-cookie', cookie(SESSION_COOKIE, session, { maxAge, path: '/' }));
    headers.append('set-cookie', cookie(CHALLENGE_COOKIE, '', { maxAge: 0, path: '/api/auth/' }));
    return Response.json({ admin: name }, { headers });
}

async function findInvite(env: AuthEnv, token: string): Promise<{ tokenHash: string; username: string } | null> {
    if (token === '') {
        return null;
    }
    const tokenDigest = await sha256(token);
    const tokenHash = tokenDigest.toHex();
    const invite = await orm(env.DB)
        .select({ tokenHash: schema.invite.tokenHash, username: schema.invite.username })
        .from(schema.invite)
        .where(
            and(eq(schema.invite.tokenHash, tokenHash), isNull(schema.invite.usedAt), gt(schema.invite.expiresAt, NOW)),
        )
        .get();
    return invite ?? null;
}

async function challengeCookie(env: AuthEnv, challenge: string): Promise<string> {
    const value = await sign(env, { challenge, exp: Date.now() + CHALLENGE_MS });
    return cookie(CHALLENGE_COOKIE, value, { maxAge: CHALLENGE_MS / 1000, path: '/api/auth/', sameSite: 'Strict' });
}

async function readChallenge(request: Request, env: AuthEnv): Promise<string | null> {
    const payload = await readSigned(request, env, CHALLENGE);
    return payload?.challenge ?? null;
}

async function sha256(text: string): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', ENCODER.encode(text)));
}
