import { cookie } from './session';

/** Carries the D1 Sessions API bookmark, so a client that just wrote can read its own write. */
export const BOOKMARK_HEADER = 'x-d1-bookmark';

/** The same bookmark for a browser, which sends it back on every read without the web app handling it. */
export const BOOKMARK_COOKIE = 'd1_bookmark';

// Long enough to cover replication lag and the next few pages; an old bookmark only asks for data at least that new,
// which every replica soon has.
const BOOKMARK_COOKIE_SECONDS = 300;

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

/** A write that worked: no body, and its bookmark as a header and a cookie, so the next read sees the write. */
export function written(session: D1DatabaseSession, headers: Record<string, string> = {}): Response {
    const bookmark = session.getBookmark() ?? '';
    return new Response(null, {
        status: 204,
        headers: {
            [BOOKMARK_HEADER]: bookmark,
            'set-cookie': cookie(BOOKMARK_COOKIE, bookmark, { maxAge: BOOKMARK_COOKIE_SECONDS, path: '/' }),
            ...headers,
        },
    });
}
