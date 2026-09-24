import { describe, expect, it, vi } from 'vitest';
import { type TranscodeEnv, transcodeVideo } from '../../src/video';

/** Credentials to sign with, and a transcoder that answers every request with `respond`, recording what it was sent. */
function transcoderEnv(respond: () => Response): { env: TranscodeEnv; requests: Request[] } {
    const requests: Request[] = [];
    const env: TranscodeEnv = {
        R2_ACCESS_KEY_ID: 'test-access-key',
        R2_SECRET_ACCESS_KEY: 'test-secret-key',
        MEDIA_BUCKET: 'test-media',
        TRANSCODER: {
            getByName: () => ({
                fetch: async (input, init): Promise<Response> => {
                    requests.push(new Request(input, init));
                    return respond();
                },
            }),
        },
    };
    return { env, requests };
}

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

        await expect(transcodeVideo(env, 'inbox/a.mov', 'derived/a.mov/v1')).resolves.toStrictEqual({
            ok: true,
            width,
            height,
            durationSeconds: 9.6,
        });
    });

    it('hands the container signed URLs for the source and both outputs', async () => {
        vi.spyOn(console, 'info').mockReturnValue();
        const { env, requests } = transcoderEnv(() => transcoded(0));
        await transcodeVideo(env, 'inbox/2024/06-15/a.mov', 'derived/2024/06-15/a.mov/v1');
        const body = await requests[0]?.json<Record<string, string>>();
        const paths = Object.fromEntries(
            Object.entries(body ?? {}).map(([name, url]) => [name, new URL(url).pathname]),
        );

        expect(paths).toStrictEqual({
            src: '/test-media/inbox/2024/06-15/a.mov',
            mp4Put: '/test-media/derived/2024/06-15/a.mov/v1/video.mp4',
            posterPut: '/test-media/derived/2024/06-15/a.mov/v1/poster.jpg',
        });
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

        await expect(transcodeVideo(env, 'inbox/a.mov', 'derived/a.mov/v1')).resolves.toStrictEqual({
            ok: false,
            error,
        });
    });

    it('throws on any other failure, so the queue retries it', async () => {
        const { env } = transcoderEnv(() => new Response('starting up', { status: 503 }));

        await expect(transcodeVideo(env, 'inbox/a.mov', 'derived/a.mov/v1')).rejects.toThrow(
            'transcode failed 503: starting up',
        );
    });
});
