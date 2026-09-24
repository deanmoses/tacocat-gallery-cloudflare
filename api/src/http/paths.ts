/** The URL path after `prefix`, percent-decoded: `/raw/a%20b` with prefix `/raw/` is `a b`. */
export function pathAfter(url: URL, prefix: string): string {
    return decodeURIComponent(url.pathname.slice(prefix.length));
}
