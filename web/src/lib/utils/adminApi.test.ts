import { describe, expect, it } from 'vitest';
import { API, AUTH_STATUS_HEADER } from '@tacocat-gallery/shared';
import { sessionStore } from '$lib/stores/SessionStore.svelte';
import { jsonResponse } from '$lib/test-support/http';
import { signedIn } from '$lib/test-support/session';
import { callApi, failureMessage } from './adminApi';

const ALBUM = '/2024/06-15/';

describe(callApi, () => {
    it('makes an admin whose session lapsed a guest when a write is refused for it', async () => {
        const server = await signedIn('moses');
        server.put(
            `/api/album${ALBUM}`,
            Response.json(
                { errorMessage: 'Unauthorized' },
                { status: 401, headers: { [AUTH_STATUS_HEADER]: 'invalid' } },
            ),
        );

        const response = await callApi(API.createAlbum, ALBUM, {});

        expect(response.status).toBe(401);
        expect(sessionStore.isAdmin).toBe(false);
    });

    it('leaves the admin logged in when the write is refused for another reason', async () => {
        const server = await signedIn('moses');
        server.put(`/api/album${ALBUM}`, jsonResponse({ errorMessage: 'Album already exists' }, 400));

        const response = await callApi(API.createAlbum, ALBUM, {});

        await expect(failureMessage(response)).resolves.toBe('Album already exists');
        expect(sessionStore.isAdmin).toBe(true);
    });
});
