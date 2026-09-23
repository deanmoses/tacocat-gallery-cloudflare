/** Carries the D1 Sessions API bookmark, so a client that just wrote can read its own write. */
export const BOOKMARK_HEADER = 'x-d1-bookmark';

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

export function notFound(details: Record<string, unknown> = {}): Response {
    return json({ error: 'not found', ...details }, 404);
}

/** The URL path after `prefix`, percent-decoded: `/raw/a%20b` with prefix `/raw/` is `a b`. */
export function pathAfter(url: URL, prefix: string): string {
    return decodeURIComponent(url.pathname.slice(prefix.length));
}
