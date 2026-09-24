/**
 * The Worker's secrets for every test, in place of api/.dev.vars, so no test needs that file or sees what is in it.
 * Loaded both in workerd and in Node, so only APIs the two share.
 */
export const TEST_SECRETS = {
    SESSION_SECRET: 'test-session-secret',
    R2_ACCESS_KEY_ID: 'test-access-key',
    R2_SECRET_ACCESS_KEY: 'test-secret-key',
    GLOBALPING_TOKEN: 'test-globalping-token',
    DEBUGBEAR_API_KEY: 'test-debugbear-key',
};

const ENCODER = new TextEncoder();

/**
 * A session cookie signed the way the Worker signs one, built independently of src/session.ts so a change to the
 * cookie format fails a test.
 */
export async function adminCookie(
    name = 'Test Admin',
    expiresAt = Date.now() + 60_000,
    secret = TEST_SECRETS.SESSION_SECRET,
): Promise<string> {
    const body = base64url(ENCODER.encode(JSON.stringify({ name, exp: expiresAt })));
    const key = await crypto.subtle.importKey('raw', ENCODER.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
    ]);
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, ENCODER.encode(body)));
    return `admin_session=${body}.${base64url(signature)}`;
}

// Node 24 has no Uint8Array.prototype.toBase64.
function base64url(bytes: Uint8Array): string {
    return btoa(String.fromCodePoint(...bytes))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');
}
