import { describe, expect, it } from 'vitest';
import { jsonResponse, serverError } from '$lib/test-support/http';
import { failureMessage, serverMessage } from './adminApi';

describe(failureMessage, () => {
    it.each([
        {
            name: 'a refusal for want of a session',
            response: () => jsonResponse({ errorMessage: 'Unauthorized' }, 401),
            message: 'Your session has expired; please log back in.',
        },
        {
            name: "the server's account",
            response: () => jsonResponse({ errorMessage: 'Album already exists' }, 400),
            message: 'Album already exists',
        },
        {
            name: 'the status text of a failure without one',
            response: () => serverError(),
            message: 'Internal Server Error',
        },
    ])('gives $name', async ({ response, message }) => {
        await expect(failureMessage(response())).resolves.toBe(message);
    });
});

describe(serverMessage, () => {
    // A failed passkey login is refused with its own reason
    it('keeps the reason a 401 gives', async () => {
        const response = jsonResponse({ errorMessage: 'Passkey could not be verified.' }, 401);

        await expect(serverMessage(response)).resolves.toBe('Passkey could not be verified.');
    });
});
