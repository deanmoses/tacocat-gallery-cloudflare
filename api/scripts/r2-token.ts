import { createHash } from 'node:crypto';
import * as valibot from 'valibot';
import { ACCOUNT_ID, type S3Credentials } from '../src/storage/s3.ts';

// What the token-verify route answers with, of which the token's id is the S3 access key id.
const VERIFIED = valibot.looseObject({ result: valibot.looseObject({ id: valibot.string() }) });

/**
 * An API token as S3 credentials: its id is the access key id, and the SHA-256 of its value the secret. The id comes
 * from the verify route, which is the one route every token may call; the account's, since the token is an account
 * token and the user route answers nothing for one.
 */
export async function tokenCredentials(token: string): Promise<S3Credentials> {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/tokens/verify`, {
        headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
        throw new Error(`verifying the API token failed: ${String(response.status)}`);
    }
    const { result } = valibot.parse(VERIFIED, await response.json());
    return { R2_ACCESS_KEY_ID: result.id, R2_SECRET_ACCESS_KEY: createHash('sha256').update(token).digest('hex') };
}
