import type { ErrorResponse } from 'tacocat-gallery-shared';

/** Pretty-printed, since people read these responses in a browser or curl while measuring. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body, null, 2), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
    });
}

export function html(page: string): Response {
    return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/** A failed request, with the one body shape the web app reads a message from. */
export function failure(status: number, errorMessage: string, headers: Record<string, string> = {}): Response {
    return json({ errorMessage } satisfies ErrorResponse, status, headers);
}

export function notFound(errorMessage = 'Not Found'): Response {
    return failure(404, errorMessage);
}
