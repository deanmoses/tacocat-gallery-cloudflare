import { Container } from '@cloudflare/containers';
import * as valibot from 'valibot';
import { VIDEO_FILE } from 'tacocat-gallery-shared';
import { notFound, pathAfter } from './http';
import { presign } from './s3';

/** ffmpeg in a container; see transcoder/server.ts. */
export class Transcoder extends Container {
    public override defaultPort = 8080;
    public override sleepAfter = '10s';
}

// The container answers this when ffmpeg or ffprobe rejects the file; see transcoder/server.ts.
const UNPROCESSABLE = 422;

const FAILURE = valibot.object({ error: valibot.string() });

/** What the Worker reads from the container's report; the rest is kept for the log. */
const TRANSCODE_RESULT = valibot.looseObject({
    output: valibot.looseObject({
        codedWidth: valibot.number(),
        codedHeight: valibot.number(),
        rotation: valibot.number(),
        durationSeconds: valibot.number(),
    }),
});

/** What transcoding needs from the bindings, with the transcoder as anything that answers fetch. */
export interface TranscodeEnv extends Pick<Env, 'R2_ACCESS_KEY_ID' | 'R2_SECRET_ACCESS_KEY' | 'MEDIA_BUCKET'> {
    TRANSCODER: {
        getByName: (name: string) => { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
    };
}

export type TranscodeOutcome =
    { ok: true; width: number; height: number; durationSeconds: number } | { ok: false; error: string };

/**
 * Hands the container presigned URLs for the source and both outputs, and returns the display size. A file ffmpeg
 * rejects comes back as a failed outcome, since the same file would fail again; anything else throws so the queue
 * retries it.
 */
export async function transcodeVideo(
    env: TranscodeEnv,
    sourceKey: string,
    derivedPrefix: string,
): Promise<TranscodeOutcome> {
    const body = JSON.stringify({
        src: await presign(env, { method: 'GET', key: sourceKey }),
        mp4Put: await presign(env, { method: 'PUT', key: `${derivedPrefix}/${VIDEO_FILE}`, contentType: 'video/mp4' }),
        posterPut: await presign(env, {
            method: 'PUT',
            key: `${derivedPrefix}/poster.jpg`,
            contentType: 'image/jpeg',
        }),
    });
    const started = Date.now();
    const transcoder = env.TRANSCODER.getByName('transcoder');
    const response = await transcoder.fetch('http://transcoder/transcode', { method: 'POST', body });
    const text = await response.text();
    if (response.status === UNPROCESSABLE) {
        return { ok: false, error: failureMessage(text) };
    }
    if (!response.ok) {
        throw new Error(`transcode failed ${response.status}: ${text}`);
    }
    const result = valibot.parse(TRANSCODE_RESULT, JSON.parse(text));
    console.info({ event: 'video_transcoded', sourceKey, wallMs: Date.now() - started, ...result });
    const isQuarterTurn = Math.abs(result.output.rotation) % 180 === 90;
    return {
        ok: true,
        width: isQuarterTurn ? result.output.codedHeight : result.output.codedWidth,
        height: isQuarterTurn ? result.output.codedWidth : result.output.codedHeight,
        durationSeconds: result.output.durationSeconds,
    };
}

/** The container's error text, whether or not it managed to wrap it in JSON. */
function failureMessage(text: string): string {
    const parsed = valibot.safeParse(FAILURE, parseJson(text));
    return parsed.success ? parsed.output.error : text;
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

/** Byte-range serving, which video playback and seeking depend on. */
export async function media(request: Request, env: Env): Promise<Response> {
    const key = pathAfter(new URL(request.url), '/v/');
    const object = await env.MEDIA.get(key, { range: request.headers });
    if (!object) {
        return notFound();
    }
    const headers = new Headers({ 'accept-ranges': 'bytes', etag: object.httpEtag });
    object.writeHttpMetadata(headers);
    if (request.headers.has('range') && object.range && 'offset' in object.range) {
        const start = object.range.offset ?? 0;
        const end = start + (object.range.length ?? object.size - start) - 1;
        headers.set('content-range', `bytes ${start}-${end}/${object.size}`);
        return new Response(object.body, { status: 206, headers });
    }
    return new Response(object.body, { headers });
}
