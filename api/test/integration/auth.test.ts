import { API, type Endpoint, apiUrl } from '@tacocat-gallery/shared';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ORIGIN, call, callAsAdmin } from '../helpers';
import { adminCookie } from '../secrets';

describe('session', () => {
    it('reports a guest without a cookie', async () => {
        const response = await call('/api/auth/status');

        await expect(response.json()).resolves.toStrictEqual({ admin: null });
        expect(response.headers.get('x-auth-status')).toBe('guest');
        expect(response.headers.get('set-cookie')).toBeNull();
    });

    it('reports the admin with a signed cookie', async () => {
        const response = await callAsAdmin('/api/auth/status');

        await expect(response.json()).resolves.toStrictEqual({ admin: 'moses' });
        expect(response.headers.get('x-auth-status')).toBe('admin');
    });

    it('reads its own session past a cookie another host of the site planted under a longer path', async () => {
        // The browser sends the longer path's cookie first. It cannot take one named __Host- from another host.
        const planted = 'admin_session=junk';
        const response = await call('/api/auth/status', { headers: { cookie: `${planted}; ${await adminCookie()}` } });

        await expect(response.json()).resolves.toStrictEqual({ admin: 'moses' });
    });

    it('rejects a tampered cookie', async () => {
        const cookie = await adminCookie();
        const tampered = cookie.replace(/.(?=\.[^.]+$)/v, 'x');
        const response = await call('/api/auth/status', { headers: { cookie: tampered } });

        await expect(response.json()).resolves.toStrictEqual({ admin: null });
    });

    it('rejects an expired cookie', async () => {
        const cookie = await adminCookie('Old', Date.now() - 31 * 86_400_000, Date.now() - 1);
        const response = await call('/api/auth/status', { headers: { cookie } });

        await expect(response.json()).resolves.toStrictEqual({ admin: null });
        expect(response.headers.get('set-cookie')).toBeNull();
    });

    it('clears the cookie on logout', async () => {
        const response = await call('/api/auth/logout', { method: 'POST', headers: { origin: ORIGIN } });

        expect(response.headers.get('set-cookie')).toMatch(/^__Host-admin_session=; Max-Age=0;/v);
    });
});

describe('session renewal', () => {
    const DAY = 86_400_000;

    it('leaves a session signed less than a day ago alone', async () => {
        const cookie = await adminCookie('moses', Date.now() - DAY / 2);
        const response = await call('/api/auth/status', { headers: { cookie } });

        expect(response.headers.get('set-cookie')).toBeNull();
    });

    it('answers a session signed more than a day ago with a fresh 30-day one', async () => {
        const cookie = await adminCookie('moses', Date.now() - DAY - 60_000);
        const response = await call('/api/auth/status', { headers: { cookie } });
        const renewed = response.headers.get('set-cookie') ?? '';
        const [value = ''] = renewed.split(';', 1);
        const { body = '' } = /^__Host-admin_session=(?<body>[^.]+)\./v.exec(value)?.groups ?? {};
        const { exp } = JSON.parse(atob(body.replaceAll('-', '+').replaceAll('_', '/'))) as { exp: number };
        const status = await call('/api/auth/status', { headers: { cookie: value } });

        expect(renewed).toMatch(
            /^__Host-admin_session=[^;]+; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Strict$/v,
        );
        expect(exp).toBeGreaterThan(Date.now() + 30 * DAY - 60_000);
        await expect(status.json()).resolves.toStrictEqual({ admin: 'moses' });
    });

    it('goes by when the session was signed, whatever expiry it was signed with', async () => {
        const cookie = await adminCookie('moses', Date.now() - 2 * DAY, Date.now() + 60 * DAY);
        const response = await call('/api/auth/status', { headers: { cookie } });

        expect(response.headers.get('set-cookie')).toMatch(/^__Host-admin_session=/v);
    });

    it('renews alongside the cookies a write sets', async () => {
        const cookie = await adminCookie('moses', Date.now() - 28 * DAY);
        const response = await call('/api/album/2001/', { method: 'PUT', headers: { cookie }, body: '{}' });
        const names = response.headers.getSetCookie().map((header) => header.split('=', 1)[0]);

        expect(response.status).toBe(204);
        expect(new Set(names)).toStrictEqual(new Set(['__Host-admin_session', '__Host-d1_bookmark']));
    });

    it('lets logout clear an old session rather than renew it', async () => {
        const cookie = await adminCookie('moses', Date.now() - 28 * DAY);
        const response = await call('/api/auth/logout', { method: 'POST', headers: { origin: ORIGIN, cookie } });

        expect(response.headers.getSetCookie()).toStrictEqual([
            expect.stringMatching(/^__Host-admin_session=; Max-Age=0;/v),
        ]);
    });
});

describe('passkey endpoints', () => {
    it('refuses a request without an allowed Origin', async () => {
        const missing = await call('/api/auth/login/options', { method: 'POST' });
        const foreign = await call('/api/auth/login/options', {
            method: 'POST',
            headers: { origin: 'https://evil.example' },
        });

        expect(missing.status).toBe(403);
        expect(foreign.status).toBe(403);
    });

    it("accepts the environment's own site as the Origin", async () => {
        const response = await call('/api/auth/login/options', {
            method: 'POST',
            headers: { origin: env.SITE_ORIGIN },
        });
        const options = await response.json<{ rpId: string }>();

        expect(response.status).toBe(200);
        expect(options.rpId).toBe(new URL(env.SITE_ORIGIN).hostname);
    });

    it('issues login options bound to the Origin host, with a challenge cookie', async () => {
        const response = await call('/api/auth/login/options', { method: 'POST', headers: { origin: ORIGIN } });
        const options = await response.json<{ rpId: string; challenge: string }>();

        expect(response.status).toBe(200);
        expect(options.rpId).toBe('localhost');
        expect(options.challenge).not.toBe('');
        expect(response.headers.get('set-cookie')).toMatch(/^pk_challenge=.+SameSite=Strict$/v);
    });

    it('refuses registration with an unknown invite', async () => {
        const response = await call('/api/auth/register/options', {
            method: 'POST',
            headers: { origin: ORIGIN, 'content-type': 'application/json' },
            body: JSON.stringify({ token: 'not-a-real-invite' }),
        });

        expect(response.status).toBe(400);
    });
});

describe('admin-only endpoints', () => {
    const adminOnly: [string, Endpoint][] = Object.entries(API).filter(([, endpoint]) => 'admin' in endpoint);

    it.each(adminOnly)('%s refuses a guest', async (_name, endpoint) => {
        const url = 'prefix' in endpoint ? apiUrl(endpoint, '/2001/12-31/') : apiUrl(endpoint);
        const response = await call(url, { method: endpoint.method, body: '{}' });

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toStrictEqual({ errorMessage: 'Unauthorized' });
    });

    it('refuses a write from a page on another host of the site, which sends the cookie whatever SameSite says', async () => {
        const response = await callAsAdmin('/api/album-rename/2001/12-31/', {
            method: 'POST',
            // As a form or a text/plain fetch sends it: no preflight asks the Worker first.
            headers: { origin: 'https://other.deanmoses.com', 'content-type': 'text/plain' },
            body: JSON.stringify({ newName: '01-01' }),
        });

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toStrictEqual({ errorMessage: 'origin not allowed' });
    });

    it('refuses a write from a page whose origin the browser hides, which is no script', async () => {
        const response = await callAsAdmin('/api/album/2001/', {
            method: 'PUT',
            // What a sandboxed iframe or a data: URL page sends.
            headers: { origin: 'null' },
            body: '{}',
        });

        expect(response.status).toBe(403);
    });

    it('refuses a write from a page on localhost where the environment lists no local origins, as production', async () => {
        const response = await callAsAdmin(
            '/api/album/2001/',
            { method: 'PUT', headers: { origin: 'http://localhost:5173' }, body: '{}' },
            { LOCAL_ORIGINS: [] },
        );

        expect(response.status).toBe(403);
    });

    it.each([
        { what: "the site's own pages", origin: env.SITE_ORIGIN },
        { what: 'a script, which names no page', origin: undefined },
    ])('takes a write from $what', async ({ origin }) => {
        const response = await callAsAdmin('/api/album/2001/', {
            method: 'PUT',
            headers: origin === undefined ? {} : { origin },
            body: '{}',
        });

        expect(response.status).toBe(204);
    });
});
