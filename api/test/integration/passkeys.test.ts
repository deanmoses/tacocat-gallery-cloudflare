import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { orm, schema } from '../../src/db';
import { SoftwareAuthenticator } from '../authenticator';
import { ORIGIN, call } from '../helpers';

const TOKEN = 'invite-token';
const DAY_MS = 86_400_000;

/** Stores an invite for `username`, one of the seeded users, as api/scripts/invite.sh does: only the hash of its token. */
async function invite(username: string, expiresAt = new Date(Date.now() + DAY_MS), token = TOKEN): Promise<void> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    await orm(env.DB)
        .insert(schema.invite)
        .values({ tokenHash: new Uint8Array(digest).toHex(), username, expiresAt: expiresAt.toISOString() });
}

/** A browser on the local dev origin: it sends the Origin header and keeps the cookies the Worker sets. */
class Browser {
    private readonly cookies = new Map<string, string>();

    async post(path: string, body?: unknown): Promise<Response> {
        const response = await call(path, {
            method: 'POST',
            headers: { origin: ORIGIN, 'content-type': 'application/json', cookie: this.cookieHeader() },
            ...(body !== undefined && { body: JSON.stringify(body) }),
        });
        for (const header of response.headers.getSetCookie()) {
            const [pair = ''] = header.split(';', 1);
            const [name = '', value = ''] = pair.split('=', 2);
            if (value === '') {
                this.cookies.delete(name);
            } else {
                this.cookies.set(name, value);
            }
        }
        return response;
    }

    /** Who the Worker says is logged in with this browser's cookies. */
    async admin(): Promise<string | null> {
        const response = await call('/api/auth/status', { headers: { cookie: this.cookieHeader() } });
        const { admin } = await response.json<{ admin: string | null }>();
        return admin;
    }

    /** Another browser holding the same cookies, as someone who copied them would. */
    copy(): Browser {
        const other = new Browser();
        for (const [name, value] of this.cookies) {
            other.cookies.set(name, value);
        }
        return other;
    }

    private cookieHeader(): string {
        return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }
}

async function challenge(options: Response): Promise<string> {
    const { challenge: value } = await options.json<{ challenge: string }>();
    return value;
}

async function register(browser: Browser, authenticator: SoftwareAuthenticator, token = TOKEN): Promise<Response> {
    const options = await browser.post('/api/auth/register/options', { token });
    const response = await authenticator.register(ORIGIN, await challenge(options));
    return browser.post('/api/auth/register/verify', { token, response });
}

async function logIn(browser: Browser, authenticator: SoftwareAuthenticator): Promise<Response> {
    const options = await browser.post('/api/auth/login/options');
    return browser.post('/api/auth/login/verify', await authenticator.assert(ORIGIN, await challenge(options)));
}

async function storedPasskeys(): Promise<(typeof schema.passkey.$inferSelect)[]> {
    return orm(env.DB).select().from(schema.passkey).all();
}

describe('registering a passkey through an invite', () => {
    it('stores the passkey for the invited admin and logs them in', async () => {
        await invite('moses');
        const browser = new Browser();
        const authenticator = await SoftwareAuthenticator.create();
        const response = await register(browser, authenticator);

        await expect(response.json()).resolves.toStrictEqual({ admin: 'moses' });
        await expect(browser.admin()).resolves.toBe('moses');
        await expect(storedPasskeys()).resolves.toMatchObject([
            { credentialId: authenticator.id, username: 'moses', counter: 0, transports: ['internal'] },
        ]);
    });

    it('uses the invite up', async () => {
        await invite('moses');
        await register(new Browser(), await SoftwareAuthenticator.create());
        const again = await new Browser().post('/api/auth/register/options', { token: TOKEN });

        expect(again.status).toBe(400);
    });

    it('yields one passkey when the invite is used twice at once', async () => {
        await invite('moses');
        const attempts = await Promise.all(
            Array.from({ length: 2 }, async () => {
                const browser = new Browser();
                const options = await browser.post('/api/auth/register/options', { token: TOKEN });
                return { browser, challenge: await challenge(options) };
            }),
        );
        const responses = await Promise.all(
            attempts.map(async ({ browser, challenge: value }) => {
                const authenticator = await SoftwareAuthenticator.create();
                const response = await authenticator.register(ORIGIN, value);
                return browser.post('/api/auth/register/verify', { token: TOKEN, response });
            }),
        );

        expect(responses.map((response) => response.status).toSorted((first, second) => first - second)).toStrictEqual([
            200, 400,
        ]);
        await expect(storedPasskeys()).resolves.toHaveLength(1);
    });

    it('refuses an answer to another challenge, without saying why', async () => {
        await invite('moses');
        const browser = new Browser();
        await browser.post('/api/auth/register/options', { token: TOKEN });
        const authenticator = await SoftwareAuthenticator.create();
        const response = await browser.post('/api/auth/register/verify', {
            token: TOKEN,
            response: await authenticator.register(ORIGIN, 'another-challenge'),
        });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({ error: 'Passkey could not be verified.' });
        await expect(storedPasskeys()).resolves.toStrictEqual([]);
    });

    it('refuses an expired invite', async () => {
        await invite('moses', new Date(Date.now() - 1000));
        const response = await new Browser().post('/api/auth/register/options', { token: TOKEN });

        expect(response.status).toBe(400);
    });
});

describe('logging in with a passkey', () => {
    let authenticator: SoftwareAuthenticator;

    // Two admins, so a login has to pick out the right one.
    beforeEach(async () => {
        await invite('moses');
        await invite('lucie', undefined, 'another-invite-token');
        authenticator = await SoftwareAuthenticator.create();
        await register(new Browser(), await SoftwareAuthenticator.create());
        await register(new Browser(), authenticator, 'another-invite-token');
    });

    it('logs in the admin it was registered to, and records its use', async () => {
        const browser = new Browser();
        const response = await logIn(browser, authenticator);
        const used = await orm(env.DB)
            .select({
                username: schema.passkey.username,
                counter: schema.passkey.counter,
                lastUsedAt: schema.passkey.lastUsedAt,
            })
            .from(schema.passkey)
            .where(eq(schema.passkey.credentialId, authenticator.id))
            .get();

        await expect(response.json()).resolves.toStrictEqual({ admin: 'lucie' });
        await expect(browser.admin()).resolves.toBe('lucie');
        expect(used).toStrictEqual({ username: 'lucie', counter: 1, lastUsedAt: expect.any(String) });
    });

    it('refuses a passkey registered nowhere', async () => {
        const browser = new Browser();
        const response = await logIn(browser, await SoftwareAuthenticator.create());

        expect(response.status).toBe(401);
        await expect(browser.admin()).resolves.toBeNull();
    });

    it("refuses another key's signature under the registered passkey's id", async () => {
        const browser = new Browser();
        const options = await browser.post('/api/auth/login/options');
        const impostor = await SoftwareAuthenticator.create();
        const forged = await impostor.assert(ORIGIN, await challenge(options));
        const response = await browser.post('/api/auth/login/verify', {
            ...forged,
            id: authenticator.id,
            rawId: authenticator.id,
        });

        expect(response.status).toBe(401);
        await expect(browser.admin()).resolves.toBeNull();
    });

    it('refuses an answer to the challenge of an earlier login attempt', async () => {
        const browser = new Browser();
        const earlier = await challenge(await browser.post('/api/auth/login/options'));
        await browser.post('/api/auth/login/options');
        const response = await browser.post('/api/auth/login/verify', await authenticator.assert(ORIGIN, earlier));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toStrictEqual({ error: 'Passkey could not be verified.' });
        await expect(browser.admin()).resolves.toBeNull();
    });

    it('refuses a login without the challenge cookie from its own options call', async () => {
        const options = await new Browser().post('/api/auth/login/options');
        const assertion = await authenticator.assert(ORIGIN, await challenge(options));
        const browser = new Browser();
        const response = await browser.post('/api/auth/login/verify', assertion);

        expect(response.status).toBe(400);
        await expect(browser.admin()).resolves.toBeNull();
    });

    // Someone who copied both the assertion and the challenge cookie, within the cookie's five minutes.
    it.each([
        { what: 'counts its uses', counts: true },
        { what: 'reports a sign count of 0 every time', counts: false },
    ])('refuses a login replayed with its challenge cookie, from a passkey that $what', async ({ counts }) => {
        const passkey = await SoftwareAuthenticator.create({ counts });
        await invite('felix', undefined, 'third-invite-token');
        await register(new Browser(), passkey, 'third-invite-token');
        const browser = new Browser();
        const options = await browser.post('/api/auth/login/options');
        const assertion = await passkey.assert(ORIGIN, await challenge(options));
        const thief = browser.copy();
        const first = await browser.post('/api/auth/login/verify', assertion);
        const replayed = await thief.post('/api/auth/login/verify', assertion);

        expect(first.status).toBe(200);
        expect(replayed.status).toBe(401);
        await expect(thief.admin()).resolves.toBeNull();
    });
});
