import * as valibot from 'valibot';

/** The body of every failed request, whatever the status: the message the web app shows. */
export const errorResponseSchema = valibot.object({ errorMessage: valibot.string() });

export type ErrorResponse = valibot.InferOutput<typeof errorResponseSchema>;

/** `body` is a failed request's, parsed. */
export function errorMessageOf(body: unknown): string | undefined {
    const parsed = valibot.safeParse(errorResponseSchema, body);
    return parsed.success ? parsed.output.errorMessage : undefined;
}
