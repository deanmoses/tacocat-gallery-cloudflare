import { DurableObject } from 'cloudflare:workers';
import * as valibot from 'valibot';

/** ffmpeg in a container; see transcoder/server.ts. */
export class VideoTranscoder extends DurableObject<Env> {
    override async fetch(request: Request): Promise<Response> {
        const { container } = this.ctx;
        if (container === undefined) {
            throw new Error('VideoTranscoder has no container');
        }
        return forwardToContainer(container, request);
    }
}

/**
 * The namespace of a container application on the scheduling policy that takes its image from wrangler.jsonc, which
 * cannot be switched to one that takes it from the Worker version. Nothing routes here; the class stays until a
 * migration deletes it, since a Worker must export every class its migrations still hold.
 */
export class Transcoder extends DurableObject<Env> {}

/** What forwardToContainer uses of a Durable Object's container, so a test can stand one in. */
export interface ContainerControl {
    readonly running: boolean;
    readonly images: Record<string, string>;
    start: (options: ContainerStartupOptions) => void;
    setInactivityTimeout: (durationMs: number) => Promise<void>;
    getTcpPort: (port: number) => { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
}

/** The key of the transcoder's image under `images` in wrangler.jsonc. */
const IMAGE = 'transcoder';
const PORT = 8080;
// An instance serves one video, so once it has answered nothing more is coming, and an idle standard-4 still bills.
const IDLE_MS = 10_000;
// About 30 s, as long as the class this replaced waited for a container and its port together.
const READY_POLL_MS = 100;
const READY_POLLS = 300;
// A connection accepted but never answered would otherwise hold the step past READY_POLLS.
const PING_TIMEOUT_MS = 5000;

/**
 * Starts the container if it is not running, waits until its server answers, and hands it the request. The largest
 * instance there is, since the admin waits through the encode and a video comes about once a month.
 */
export async function forwardToContainer(container: ContainerControl, request: Request): Promise<Response> {
    if (!container.running) {
        const image = container.images[IMAGE];
        if (image === undefined) {
            throw new Error(`no image named ${IMAGE} for the container`);
        }
        // The presigned URLs it reads and writes are on R2's public endpoint.
        container.start({ image, instance: 'standard-4', enableInternet: true });
    }
    // Every request, since a Durable Object that restarts, as on a deploy, forgets the timeout of the container it finds.
    await container.setInactivityTimeout(IDLE_MS);
    const port = container.getTcpPort(PORT);
    await untilAnswering(port);
    return port.fetch(request);
}

/** Polls the server's GET, which answers once it listens; start() returns before that. */
async function untilAnswering(port: ReturnType<ContainerControl['getTcpPort']>): Promise<void> {
    let lastError: unknown;
    for (let poll = 0; poll < READY_POLLS; poll++) {
        try {
            await port.fetch('http://container/', { signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
            return;
        } catch (error) {
            lastError = error;
            await scheduler.wait(READY_POLL_MS);
        }
    }
    throw new Error(`container not answering on port ${String(PORT)}`, { cause: lastError });
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

/**
 * Presigned URLs the container reads the source from and writes the MP4 and poster to, the source's key for the log,
 * and the version, which names the container instance.
 */
export interface TranscodeJob {
    versionId: string;
    sourceKey: string;
    src: string;
    mp4Put: string;
    posterPut: string;
}

export type TranscodeOutcome =
    { ok: true; width: number; height: number; durationSeconds: number } | { ok: false; error: string };

/**
 * Hands the container the job and returns the display size. A file ffmpeg rejects comes back as a failed outcome,
 * since the same file would fail again; anything else throws so the step retries it.
 */
export async function transcodeVideo(env: TranscodeEnv, job: TranscodeJob): Promise<TranscodeOutcome> {
    const { versionId, sourceKey, src, mp4Put, posterPut } = job;
    const body = JSON.stringify({ src, mp4Put, posterPut });
    const started = Date.now();
    // An instance per version, so the videos of one drop transcode side by side, each with a whole instance's CPU.
    const transcoder = env.TRANSCODER.getByName(versionId);
    const response = await transcoder.fetch('http://transcoder/transcode', { method: 'POST', body });
    const text = await response.text();
    if (response.status === UNPROCESSABLE) {
        return { ok: false, error: failureMessage(text) };
    }
    if (!response.ok) {
        throw new Error(`transcode failed ${response.status}: ${failureMessage(text)}`);
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
