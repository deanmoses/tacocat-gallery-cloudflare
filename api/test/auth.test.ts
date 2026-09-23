import { describe, expect, it } from 'vitest';
import { ORIGIN, adminCookie, call, callAsAdmin } from './helpers';

describe('session', () => {
    it('reports a guest without a cookie', async () => {
        const response = await call('/api/auth/status');

        await expect(response.json()).resolves.toStrictEqual({ admin: null });
        expect(response.headers.get('x-auth-status')).toBe('guest');
    });

    it('reports the admin with a signed cookie', async () => {
        const response = await callAsAdmin('/api/auth/status');

        await expect(response.json()).resolves.toStrictEqual({ admin: 'Test Admin' });
        expect(response.headers.get('x-auth-status')).toBe('admin');
    });

    it('rejects a tampered cookie', async () => {
        const cookie = await adminCookie();
        const tampered = cookie.replace(/.(?=\.[^.]+$)/v, 'x');
        const response = await call('/api/auth/status', { headers: { cookie: tampered } });

        await expect(response.json()).resolves.toStrictEqual({ admin: null });
    });

    it('rejects an expired cookie', async () => {
        const cookie = await adminCookie('Old', Date.now() - 1);
        const response = await call('/api/auth/status', { headers: { cookie } });

        await expect(response.json()).resolves.toStrictEqual({ admin: null });
    });

    it('clears the cookie on logout', async () => {
        const response = await call('/api/auth/logout', { method: 'POST', headers: { origin: ORIGIN } });

        expect(response.headers.get('set-cookie')).toMatch(/^admin_session=; Max-Age=0;/v);
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

    it('serves the login and invite screens', async () => {
        const login = await call('/login');
        const invite = await call('/invite/abc');

        await expect(login.text()).resolves.toContain('Log in with passkey');
        await expect(invite.text()).resolves.toContain('Create passkey');
    });
});

describe('admin-only writes', () => {
    it('refuses a guest', async () => {
        const response = await call('/api/item', { method: 'PUT', body: '{}' });

        expect(response.status).toBe(401);
    });
});
