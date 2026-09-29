// Strict: the browser sends a cookie only with requests from pages of the same site, the registrable domain, so a
// page on another host of it, staging say, sends it too. A link followed from elsewhere loads the app without it, and
// the app's own fetches then carry it, so the app loses nothing. A Worker URL reached straight from such a link, an
// /api/ read or an original under /raw/, answers as it would a guest.
export function cookie(name: string, value: string, options: { maxAge: number; path: string }): string {
    const attributes = [`Max-Age=${options.maxAge}`, `Path=${options.path}`, 'HttpOnly', 'Secure', 'SameSite=Strict'];
    return [`${name}=${value}`, ...attributes].join('; ');
}

export function readCookie(request: Request, name: string): string | undefined {
    const header = request.headers.get('cookie') ?? '';
    for (const part of header.split(';')) {
        const [key, ...value] = part.trim().split('=');
        if (key === name) {
            return value.join('=');
        }
    }
    return undefined;
}
