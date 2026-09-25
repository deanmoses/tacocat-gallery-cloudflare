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

describe('HEAD', () => {
    it('reaches the GET handler and answers without a body', async () => {
        const response = await call('/api/health', { method: 'HEAD' });

        expect(response.status).toBe(200);
        await expect(response.text()).resolves.toBe('');
    });
});
