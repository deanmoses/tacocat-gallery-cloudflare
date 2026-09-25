import * as valibot from 'valibot';
import { d1Header } from '../db/timing';
import type { Written } from '../gallery/writes';
import { written } from '../http/bookmark';
import { failure } from '../http/responses';

// What the admin write routes share: reading a body, and answering a write.

/** The body as `shape`, or the 400 for one that is not; nothing at all is an empty body, which is what the app sends for a create. */
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

/** The bookmark to read the write back with, and what it cost. */
export function wrote(session: D1DatabaseSession, write: Written, started: number): Response {
    return written(session, write.meta === null ? {} : { 'x-d1': d1Header(write.meta, performance.now() - started) });
}
