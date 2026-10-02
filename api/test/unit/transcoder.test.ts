import { describe, expect, it, vi } from 'vitest';
import {
    type ContainerControl,
    type TranscodeEnv,
    type TranscodeJob,
    forwardToContainer,
    transcodeVideo,
} from '../../src/media/transcoder';

/** A transcoder that answers every request with `respond`, recording what it was sent and which instance took it. */
function transcoderEnv(respond: () => Response): { env: TranscodeEnv; requests: Request[]; instances: string[] } {
    const requests: Request[] = [];
    const instances: string[] = [];
    const env: TranscodeEnv = {
        TRANSCODER: {
            getByName: (name) => ({
                fetch: async (input, init): Promise<Response> => {
                    instances.push(name);
                    requests.push(new Request(input, init));
                    return respond();
                },
            }),
        },
    };
    return { env, requests, instances };
}

const JOB: TranscodeJob = {
    versionId: 'v1',
    sourceKey: 'inbox/a',
    src: 'https://bucket.example/inbox/a?signed',
    mp4Put: 'https://bucket.example/derived/v1/video.mp4?signed',
    posterPut: 'https://bucket.example/derived/v1/poster.jpg?signed',
};

function transcoded(rotation: number): Response {
    return Response.json({ output: { codedWidth: 1920, codedHeight: 1080, rotation, durationSeconds: 9.6 } });
}

describe(transcodeVideo, () => {
    it.each([
        [0, 1920, 1080],
        [90, 1080, 1920],
        [-90, 1080, 1920],
        [180, 1920, 1080],
        [270, 1080, 1920],
    ])('reports the display size of frames rotated %i degrees as %ix%i', async (rotation, width, height) => {
        vi.spyOn(console, 'info').mockReturnValue();
        const { env } = transcoderEnv(() => transcoded(rotation));

        await expect(transcodeVideo(env, JOB)).resolves.toStrictEqual({
            ok: true,
            width,
            height,
            durationSeconds: 9.6,
        });
    });

    it('hands the container the URLs for the source and both outputs, and nothing else', async () => {
        vi.spyOn(console, 'info').mockReturnValue();
        const { env, requests } = transcoderEnv(() => transcoded(0));
        await transcodeVideo(env, JOB);
        const body = await requests[0]?.json<Record<string, string>>();

        expect(body).toStrictEqual({ src: JOB.src, mp4Put: JOB.mp4Put, posterPut: JOB.posterPut });
    });

    it('sends each version to a container instance of its own', async () => {
        vi.spyOn(console, 'info').mockReturnValue();
        const { env, instances } = transcoderEnv(() => transcoded(0));
        await transcodeVideo(env, JOB);
        await transcodeVideo(env, { ...JOB, versionId: 'v2' });

        expect(instances).toStrictEqual(['v1', 'v2']);
    });

    it.each([
        {
            how: 'as JSON',
            respond: (): Response => Response.json({ error: 'moov atom not found' }, { status: 422 }),
            error: 'moov atom not found',
        },
        {
            how: 'as text',
            respond: (): Response => new Response('ffmpeg crashed', { status: 422 }),
            error: 'ffmpeg crashed',
        },
    ])('fails without throwing when ffmpeg rejects the file, reported $how', async ({ respond, error }) => {
        const { env } = transcoderEnv(respond);

        await expect(transcodeVideo(env, JOB)).resolves.toStrictEqual({ ok: false, error });
    });

    it('throws with only the error the container reported, not its JSON', async () => {
        const { env } = transcoderEnv(() =>
            Response.json({ error: 'Error: ffmpeg exited 255: received signal 15' }, { status: 500 }),
        );

        await expect(transcodeVideo(env, JOB)).rejects.toThrow(
            new Error('transcode failed 500: Error: ffmpeg exited 255: received signal 15'),
        );
    });

    it('throws on any other failure, so the step retries it', async () => {
        const { env } = transcoderEnv(() => new Response('starting up', { status: 503 }));

        await expect(transcodeVideo(env, JOB)).rejects.toThrow('transcode failed 503: starting up');
    });
});

/**
 * A container whose server starts answering after `failedPings` refused connections and then `hungPings` accepted
 * ones it never answers, recording what it was started with, the inactivity timeouts set, and every request that
 * reached its port.
 */
function fakeContainer({ running = false, failedPings = 0, hungPings = 0 } = {}): {
    container: ContainerControl;
    starts: ContainerStartupOptions[];
    timeouts: number[];
    received: Request[];
} {
    const starts: ContainerStartupOptions[] = [];
    const timeouts: number[] = [];
    const received: Request[] = [];
    let refusals = failedPings;
    let hangs = hungPings;
    let isRunning = running;
    const container: ContainerControl = {
        get running() {
            return isRunning;
        },
        images: { transcoder: 'registry.example/transcoder@sha256:abc' },
        start: (options) => {
            starts.push(options);
            isRunning = true;
        },
        setInactivityTimeout: async (durationMs) => {
            timeouts.push(durationMs);
        },
        getTcpPort: () => ({
            fetch: async (input, init): Promise<Response> => {
                if (refusals > 0) {
                    refusals--;
                    throw new Error('connection refused');
                }
                if (hangs > 0) {
                    hangs--;
                    const { signal } = new Request(input, init);
                    return new Promise((_resolve, reject) => {
                        if (signal.aborted) {
                            reject(new Error('timed out', { cause: signal.reason }));
                        }
                        signal.addEventListener('abort', () => {
                            reject(new Error('timed out', { cause: signal.reason }));
                        });
                    });
                }
                received.push(new Request(input, init));
                return new Response('ok');
            },
        }),
    };
    return { container, starts, timeouts, received };
}

const TRANSCODE = new Request('http://transcoder/transcode', { method: 'POST', body: '{"src":"x"}' });

describe(forwardToContainer, () => {
    it('starts a stopped container on the transcoder image, on the largest instance, with Internet access', async () => {
        vi.spyOn(scheduler, 'wait').mockResolvedValue();
        const { container, starts } = fakeContainer();
        await forwardToContainer(container, TRANSCODE.clone());

        expect(starts).toStrictEqual([
            { image: 'registry.example/transcoder@sha256:abc', instance: 'standard-4', enableInternet: true },
        ]);
    });

    it('hands the request over only once the server answers', async () => {
        vi.spyOn(scheduler, 'wait').mockResolvedValue();
        const { container, received } = fakeContainer({ failedPings: 3 });
        await forwardToContainer(container, TRANSCODE.clone());
        const [ping, forwarded] = received;

        expect(received).toHaveLength(2);
        expect(ping?.method).toBe('GET');
        expect(forwarded?.method).toBe('POST');
        await expect(forwarded?.text()).resolves.toBe('{"src":"x"}');
    });

    it('gives up on a check the server accepts but never answers, and checks again', async () => {
        vi.spyOn(scheduler, 'wait').mockResolvedValue();
        const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
        const { container, received } = fakeContainer({ hungPings: 1 });
        await forwardToContainer(container, TRANSCODE.clone());

        expect(timeout).toHaveBeenCalledWith(5000);
        expect(received.map(({ method }) => method)).toStrictEqual(['GET', 'POST']);
    });

    it.each([
        { running: false, started: true },
        { running: true, started: false },
    ])('logs whether it started the container: $started', async ({ running, started }) => {
        vi.spyOn(scheduler, 'wait').mockResolvedValue();
        const info = vi.spyOn(console, 'info').mockReturnValue();
        const { container } = fakeContainer({ running });
        await forwardToContainer(container, TRANSCODE.clone());

        expect(info).toHaveBeenCalledWith({ event: 'container_ready', started, readyMs: expect.any(Number) });
    });

    it('leaves a running container as it is', async () => {
        vi.spyOn(scheduler, 'wait').mockResolvedValue();
        const { container, starts } = fakeContainer({ running: true });
        await forwardToContainer(container, TRANSCODE.clone());

        expect(starts).toStrictEqual([]);
    });

    it.each([false, true])('stops the container 10 s after it goes idle, running before: %s', async (running) => {
        vi.spyOn(scheduler, 'wait').mockResolvedValue();
        const { container, timeouts } = fakeContainer({ running });
        await forwardToContainer(container, TRANSCODE.clone());

        expect(timeouts).toStrictEqual([10_000]);
    });

    it('throws, so the step retries, when the server never answers, and sends it nothing', async () => {
        vi.spyOn(scheduler, 'wait').mockResolvedValue();
        const { container, received } = fakeContainer({ failedPings: Infinity });

        await expect(forwardToContainer(container, TRANSCODE.clone())).rejects.toThrow(
            'container not answering on port 8080',
        );
        expect(received).toStrictEqual([]);
    });
});
