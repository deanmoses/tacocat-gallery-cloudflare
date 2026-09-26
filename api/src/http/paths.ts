/**
 * The URL path after `prefix`, percent-decoded: `/raw/a%20b` with prefix `/raw/` is `a b`. A path that is not valid
 * percent-encoding, `/raw/%`, is kept as it came, which names nothing, so the route answers as it does any unknown path.
 */
export function pathAfter(url: URL, prefix: string): string {
    const rest = url.pathname.slice(prefix.length);
    try {
        return decodeURIComponent(rest);
    } catch {
        return rest;
    }
}
