import { describe, expect, it, vi } from 'vitest';
import { type TranscodeEnv, type TranscodeJob, transcodeVideo } from '../../src/media/transcoder';

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
    sourceKey: 'originals/a',
    src: 'https://bucket.example/originals/a?signed',
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
