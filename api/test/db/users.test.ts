import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { orm, schema } from '../../src/db';

// Drizzle wraps D1's error, whose message names the constraint, as the cause.
const FOREIGN_KEY_FAILED = { cause: { message: expect.stringContaining('FOREIGN KEY constraint failed') } };

describe('the user table', () => {
    it('is seeded with the four admins by the migrations', async () => {
        const names = await orm(env.DB)
            .select({ username: schema.user.username })
            .from(schema.user)
            .orderBy(schema.user.username);

        expect(names.map((row) => row.username)).toStrictEqual(['felix', 'lucie', 'milo', 'moses']);
    });

    it('is what an invite must name', async () => {
        const invite = orm(env.DB)
            .insert(schema.invite)
            .values({ tokenHash: 'a'.repeat(64), username: 'nobody', expiresAt: '2999-01-01T00:00:00.000Z' });

        await expect(invite).rejects.toMatchObject(FOREIGN_KEY_FAILED);
    });

    it('is what a passkey must name', async () => {
        const passkey = orm(env.DB)
            .insert(schema.passkey)
            .values({ credentialId: 'credential', username: 'nobody', publicKey: 'key' });

        await expect(passkey).rejects.toMatchObject(FOREIGN_KEY_FAILED);
    });
});
