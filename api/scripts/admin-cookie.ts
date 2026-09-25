/**
 * A session cookie signed as the Worker signs one, for a script to call the admin routes as `name`, who has to be one
 * of the users the migrations seed when the call records who asked. Good for an hour.
 */
export async function adminCookie(secret: string, name: string): Promise<string> {
    if (secret === '') {
        throw new Error('SESSION_SECRET is not set in api/.dev.vars');
    }
    const encoder = new TextEncoder();
    const body = base64url(encoder.encode(JSON.stringify({ name, exp: Date.now() + 3_600_000 })));
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
    ]);
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
    return `admin_session=${body}.${base64url(signature)}`;
}

function base64url(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64url');
}
