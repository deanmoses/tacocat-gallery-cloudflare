import { Container } from '@cloudflare/containers';
import * as valibot from 'valibot';
import { notFound, pathAfter } from './http';
import { presign } from './s3';

/** Ffmpeg in a container; see transcoder/server.ts. */
export class Transcoder extends Container {
    public override defaultPort = 8080;
    public override sleepAfter = '10s';
}

/** What the Worker reads from the container's report; the rest is kept for the log. */
const TRANSCODE_RESULT = valibot.looseObject({
    output: valibot.looseObject({
        codedWidth: valibot.number(),
        codedHeight: valibot.number(),
        rotation: valibot.number(),
        durationSeconds: valibot.number(),
    }),
});

/** Hands the container presigned URLs for the original and both outputs, and returns the display size. */
export async function transcodeVideo(
    env: Env,
    originalKey: string,
    derivedPrefix: string,
): Promise<{ width: number; height: number; durationSeconds: number }> {
    const body = JSON.stringify({
        src: await presign(env, { method: 'GET', key: originalKey }),
        mp4Put: await presign(env, { method: 'PUT', key: `${derivedPrefix}/video.mp4`, contentType: 'video/mp4' }),
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
    if (!response.ok) {
        throw new Error(`transcode failed ${String(response.status)}: ${text}`);
    }
    const result = valibot.parse(TRANSCODE_RESULT, JSON.parse(text));
    console.info({ event: 'video_transcoded', originalKey, wallMs: Date.now() - started, ...result });
    const isQuarterTurn = Math.abs(result.output.rotation) % 180 === 90;
    return {
        width: isQuarterTurn ? result.output.codedHeight : result.output.codedWidth,
        height: isQuarterTurn ? result.output.codedWidth : result.output.codedHeight,
        durationSeconds: result.output.durationSeconds,
    };
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
        headers.set('content-range', `bytes ${String(start)}-${String(end)}/${String(object.size)}`);
        return new Response(object.body, { status: 206, headers });
    }
    return new Response(object.body, { headers });
}
