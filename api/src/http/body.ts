import * as valibot from 'valibot';
import { failure } from './responses';

/** The body as `shape`, or the 400 for one that is not; an empty body parses as `{}`. */
export async function parsedBody<T extends valibot.GenericSchema>(
    request: Request,
    shape: T,
): Promise<{ output: valibot.InferOutput<T> } | { response: Response }> {
    const text = await request.text();
    const parsed = valibot.safeParse(shape, text.trim() === '' ? {} : parseJson(text));
    return parsed.success ? { output: parsed.output } : { response: failure(400, valibot.summarize(parsed.issues)) };
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}
