import { Container } from '@cloudflare/containers';
import * as valibot from 'valibot';

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

/** The transcoder as anything that answers fetch, so a test can stand one in. */
export interface TranscodeEnv {
    TRANSCODER: {
        getByName: (name: string) => { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
    };
}

/** Presigned URLs the container reads the source from and writes the MP4 and poster to, and the source's key for the log. */
export interface TranscodeJob {
    sourceKey: string;
    src: string;
    mp4Put: string;
    posterPut: string;
}

export type TranscodeOutcome =
    { ok: true; width: number; height: number; durationSeconds: number } | { ok: false; error: string };

/**
 * Hands the container the job and returns the display size. A file ffmpeg rejects comes back as a failed outcome,
 * since the same file would fail again; anything else throws so the queue retries it.
 */
export async function transcodeVideo(env: TranscodeEnv, job: TranscodeJob): Promise<TranscodeOutcome> {
    const { sourceKey, src, mp4Put, posterPut } = job;
    const body = JSON.stringify({ src, mp4Put, posterPut });
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
