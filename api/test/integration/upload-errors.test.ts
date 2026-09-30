import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { orm, schema } from '../../src/db';
import { call, callAsAdmin, uploadErrors, write } from '../helpers';

const DAY = '/2024/06-15/';

describe('upload errors', () => {
    it('needs an admin', async () => {
        const response = await call('/api/errors', { method: 'POST', body: JSON.stringify({ paths: ['/x'] }) });

        expect(response.status).toBe(401);
    });

    it('rejects a body without paths', async () => {
        const response = await write('POST', '/api/errors', {});

        expect(response.status).toBe(400);
    });

    it('rejects a body that is not JSON', async () => {
        const response = await callAsAdmin('/api/errors', { method: 'POST', body: 'paths' });

        expect(response.status).toBe(400);
    });

    it('answers for more paths than D1 binds to one statement, as a large drop asks', async () => {
        await orm(env.DB)
            .insert(schema.uploadError)
            .values({ path: `${DAY}img_149`, message: 'the image cannot be decoded' });
        const paths = Array.from({ length: 150 }, (_, index) => `${DAY}img_${index}`);

        await expect(uploadErrors(paths)).resolves.toStrictEqual({
            [`${DAY}img_149`]: 'the image cannot be decoded',
        });
    });
});
