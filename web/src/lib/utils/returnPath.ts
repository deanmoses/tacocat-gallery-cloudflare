/**
 * The path a `returnPath` query parameter names, if it is on this site; anywhere else, such as a link crafted to send
 * someone on to another site, becomes the home page.
 */
export function sameSitePath(value: string | null, origin: string): string {
    if (value === null) return '/';
    const url = new URL(value, origin);
    return url.origin === origin ? url.pathname + url.search : '/';
}
