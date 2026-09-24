import { cookie, readCookie } from './cookies';

/** Carries the D1 Sessions API bookmark, so a client that just wrote can read its own write. */
export const BOOKMARK_HEADER = 'x-d1-bookmark';

/** The same bookmark for a browser, which sends it back on every read without the web app handling it. */
const BOOKMARK_COOKIE = 'd1_bookmark';

// Long enough to cover replication lag and the next few pages; an old bookmark only asks for data at least that new,
// which every replica soon has.
const BOOKMARK_COOKIE_SECONDS = 300;

// The shape Time Travel documents, as in 00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683.
const BOOKMARK = /^[\da-f]{8}-[\da-f]{8}-[\da-f]{8}-[\da-f]{32}$/v;

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

/** The client's bookmark, from its header or its cookie. D1 does not say what it does with a malformed one, so it gets none. */
export function requestBookmark(request: Request): string | null {
    const bookmark = request.headers.get(BOOKMARK_HEADER) ?? readCookie(request, BOOKMARK_COOKIE);
    return bookmark !== undefined && BOOKMARK.test(bookmark) ? bookmark : null;
}
