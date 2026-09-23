/**
 * Authenticated API client for admin operations.
 *
 * Provides a simple interface for making authenticated requests to the gallery API. The session is a cookie the
 * browser sends on its own, so there is nothing to attach; a 401 means it has expired.
 */

const JSON_HEADERS = {
    accept: 'application/json',
    'Content-Type': 'application/json',
};

/**
 * The server's own account of a failed request when it sent one, else the status text.
 */
export async function failureMessage(response: Response): Promise<string> {
    let body: unknown;
    try {
        body = await response.json();
    } catch {
        body = {};
    }
    return hasErrorMessage(body) && body.errorMessage !== '' ? body.errorMessage : response.statusText;
}

function hasErrorMessage(body: unknown): body is { errorMessage: string } {
    return typeof body === 'object' && body !== null && 'errorMessage' in body && typeof body.errorMessage === 'string';
}

/**
 * Authenticated API client for admin operations.
 * Sends JSON.
 */
export const adminApi = {
    async get(url: string): Promise<Response> {
        return fetch(url, {
            headers: JSON_HEADERS,
        });
    },

    async post(url: string, body: object): Promise<Response> {
        return fetch(url, {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify(body),
        });
    },

    async put(url: string, body: object = {}): Promise<Response> {
        return fetch(url, {
            method: 'PUT',
            headers: JSON_HEADERS,
            body: JSON.stringify(body),
        });
    },

    async patch(url: string, body: object): Promise<Response> {
        return fetch(url, {
            method: 'PATCH',
            headers: JSON_HEADERS,
            body: JSON.stringify(body),
        });
    },

    async delete(url: string): Promise<Response> {
        return fetch(url, {
            method: 'DELETE',
            headers: JSON_HEADERS,
        });
    },
};
