import { pathAfter } from '../http/paths';
import { json, notFound } from '../http/responses';
import { byteStream } from '../media/images';

/** Isolates Images binding failures from how the bytes reach it: R2 stream, buffered stream, and each step. */
export async function debugImage(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const key = pathAfter(url, '/debug/image/');
    const head = await env.MEDIA.get(key);
    if (!head) {
        return notFound(`No object ${key}`);
    }
    const bytes = new Uint8Array(await head.arrayBuffer());
    const blob = new Blob([bytes]);
    const buffered = (): ReadableStream<Uint8Array> => byteStream(blob.stream());
    const decoder = new TextDecoder();
    return json({
        key,
        size: bytes.length,
        magic: decoder.decode(bytes.slice(4, 12)),
        infoFromR2Stream: await attempt(async () => {
            const again = await env.MEDIA.get(key);
            if (!again) {
                throw new Error('object vanished');
            }
            return env.IMAGES.info(byteStream(again.body));
        }),
        infoBuffered: await attempt(async () => env.IMAGES.info(buffered())),
        jpegNoTransform: await attempt(async () => {
            const output = await env.IMAGES.input(buffered()).output({ format: 'image/jpeg' });
            const response = output.response();
            const body = await response.arrayBuffer();
            return { status: response.status, type: response.headers.get('content-type'), bytes: body.byteLength };
        }),
        jpegWidth512: await attempt(async () => {
            const output = await env.IMAGES.input(buffered())
                .transform({ width: 512 })
                .output({ format: 'image/jpeg' });
            const response = output.response();
            const body = await response.arrayBuffer();
            return { status: response.status, bytes: body.byteLength };
        }),
    });
}

async function attempt(
    run: () => Promise<unknown>,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
    try {
        return { ok: true, value: await run() };
    } catch (error) {
        return { ok: false, error: String(error) };
    }
}
