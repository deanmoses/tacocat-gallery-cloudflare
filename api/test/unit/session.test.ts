import * as valibot from 'valibot';
import { describe, expect, it } from 'vitest';
import { readSigned, sign } from '../../src/auth/session';

const ENV = { SESSION_SECRET: 'unit-test-secret' };
const ADMIN = { name: 'admin_session', payload: valibot.object({ name: valibot.string() }) };

function withCookie(value: string): Request {
    return new Request('http://localhost/', { headers: { cookie: `other=1; admin_session=${value}` } });
}

describe(readSigned, () => {
    it('reads back what was signed', async () => {
        const value = await sign(ENV, { name: 'Dean', exp: Date.now() + 60_000 });

        await expect(readSigned(withCookie(value), ENV, ADMIN)).resolves.toStrictEqual({ name: 'Dean' });
    });

    it('refuses a cookie signed with another secret', async () => {
        const value = await sign({ SESSION_SECRET: 'another-secret' }, { name: 'Dean', exp: Date.now() + 60_000 });

        await expect(readSigned(withCookie(value), ENV, ADMIN)).resolves.toBeNull();
    });

    it('refuses a signed payload of the wrong shape', async () => {
        const value = await sign(ENV, { name: 42, exp: Date.now() + 60_000 });

        await expect(readSigned(withCookie(value), ENV, ADMIN)).resolves.toBeNull();
    });
});

describe(sign, () => {
    it('refuses to sign without a secret', async () => {
        await expect(sign({ SESSION_SECRET: '' }, { exp: 0 })).rejects.toThrow('SESSION_SECRET is not set');
    });
});
