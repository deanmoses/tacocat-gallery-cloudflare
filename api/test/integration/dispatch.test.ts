import { describe, expect, it } from 'vitest';
import { call, callAsAdmin } from '../helpers';

describe('a request the Worker has no route for', () => {
    it('is not found, with the error body every failure has', async () => {
        const response = await call('/api/nothing');

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toStrictEqual({ errorMessage: 'Not Found' });
    });

    // A guest's write is refused before any route is looked for, so these are sent as an admin.
    it.each([
        ['DELETE', '/api/health'],
        ['POST', '/api/auth/status'],
    ])('%s %s, a method the path has no handler for, is not found', async (method, path) => {
        const response = await callAsAdmin(path, { method, headers: { origin: 'http://localhost:8787' } });

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toStrictEqual({ errorMessage: 'Not Found' });
    });
});

describe('a path that is not valid percent-encoding', () => {
    it.each(['/api/album/%', '/raw/%zz', '/v/2001/06-15/a.mov/%'])(
        '%s is not found or refused, never an exception',
        async (path) => {
            const response = await call(path);
            await response.body?.cancel();

            expect([400, 404]).toContain(response.status);
        },
    );
});

describe('HEAD', () => {
    it('reaches the GET handler and answers without a body', async () => {
        const response = await call('/api/health', { method: 'HEAD' });

        expect(response.status).toBe(200);
        await expect(response.text()).resolves.toBe('');
    });
});

describe('the image debug route', () => {
    it('needs an admin, since it reports on any object', async () => {
        const response = await call('/debug/image/2001/01-01/a.jpg');

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toStrictEqual({ errorMessage: 'Unauthorized' });
    });
});
