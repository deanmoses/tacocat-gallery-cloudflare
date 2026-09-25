import { describe, expect, inject, it } from 'vitest';
import { adminCookie } from '../secrets.ts';

describe('the local stack', () => {
    it('runs with the test secrets rather than those in .dev.vars', async () => {
        const response = await fetch(new URL('/api/auth/status', inject('stackOrigin')), {
            headers: { cookie: await adminCookie() },
        });

        await expect(response.json()).resolves.toStrictEqual({ admin: 'moses' });
    });
});
