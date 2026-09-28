/**
 * The admin's client for the gallery API: logging in, uploading and every write.
 */

import { type Endpoint, type EndpointArgs, apiUrl } from '@tacocat-gallery/shared';

/** Sends a request to `endpoint`, with the gallery path it goes on with and the JSON body it takes, both typed by it. */
export async function callApi<E extends Endpoint>(endpoint: E, ...args: EndpointArgs<E>): Promise<Response> {
    const target: Endpoint = endpoint;
    const values: readonly unknown[] = args;
    const [url, body] =
        'prefix' in target ? [apiUrl(target, String(values[0])), values[1]] : [apiUrl(target), values[0]];
    return fetch(url, {
        method: target.method,
        ...(body === undefined
            ? { headers: { accept: 'application/json' } }
            : {
                  headers: { accept: 'application/json', 'Content-Type': 'application/json' },
                  body: JSON.stringify(body),
              }),
    });
}

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
