import * as valibot from 'valibot';

/** The body of every failed request, whatever the status: the message the web app shows. */
export const errorResponseSchema = valibot.object({ errorMessage: valibot.string() });

export type ErrorResponse = valibot.InferOutput<typeof errorResponseSchema>;

/** `body` is a failed request's, parsed. */
export function errorMessageOf(body: unknown): string | undefined {
    const parsed = valibot.safeParse(errorResponseSchema, body);
    return parsed.success ? parsed.output.errorMessage : undefined;
}

/**
 * The header on every `/api/` response saying what the Worker made of the session cookie: `none` when there was
 * none, `valid` for an admin's, `invalid` for one it refused, usually because it expired. Reads never refuse, they
 * answer a refused cookie with the guest view, so this is how the app learns that its admin is a guest now.
 */
export const AUTH_STATUS_HEADER = 'x-auth-status';

export type AuthStatus = 'none' | 'valid' | 'invalid';
