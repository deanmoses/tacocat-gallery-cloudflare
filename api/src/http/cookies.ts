export function cookie(
    name: string,
    value: string,
    options: { maxAge: number; path: string; sameSite?: 'Lax' | 'Strict' },
): string {
    const attributes = [
        `Max-Age=${options.maxAge}`,
        `Path=${options.path}`,
        'HttpOnly',
        'Secure',
        `SameSite=${options.sameSite ?? 'Lax'}`,
    ];
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
