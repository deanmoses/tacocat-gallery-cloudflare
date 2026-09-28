import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The server runs as the image runs it, `node server.ts`, with bin/ first on its PATH so the fake ffmpeg and ffprobe
// there stand in for the real ones. FAKE_FFMPEG picks what the fake ffmpeg does.
const SERVER = path.join(import.meta.dirname, '../../transcoder/server.ts');
const FAKES = path.join(import.meta.dirname, 'bin');

type FakeFfmpeg = 'encode' | 'reject' | 'crash' | 'encode-forever' | 'encode-forever-quietly';

let directory: string;
let bucket: Server;
let bucketOrigin: string;
let transcoder: ChildProcess | undefined;
let transcoderOrigin: string;

function portOf(server: Server): number {
    return (server.address() as AddressInfo).port;
}

async function freePort(): Promise<number> {
    const probe = createServer().listen(0);
    await once(probe, 'listening');
    const port = portOf(probe);
    probe.close();
    return port;
}

async function startTranscoder(ffmpeg: FakeFfmpeg): Promise<ChildProcess> {
    const port = await freePort();
    transcoderOrigin = `http://localhost:${String(port)}`;
    const child = spawn(process.execPath, [SERVER], {
        env: {
            ...process.env,
            PATH: `${FAKES}:${process.env['PATH'] ?? ''}`,
            PORT: String(port),
            FAKE_FFMPEG: ffmpeg,
            FAKE_DIR: directory,
        },
        stdio: 'ignore',
    });
    transcoder = child;
    await vi.waitFor(async () => fetch(transcoderOrigin), { timeout: 5000, interval: 50 });
    return child;
}

async function transcode(init: RequestInit = {}): Promise<Response> {
    return fetch(`${transcoderOrigin}/transcode`, {
        method: 'POST',
        body: JSON.stringify({
            src: `${bucketOrigin}/inbox/v1`,
            mp4Put: `${bucketOrigin}/derived/v1/video.mp4`,
            posterPut: `${bucketOrigin}/derived/v1/poster.jpg`,
        }),
        ...init,
    });
}

/** A request whose answer the test never reads, as the Worker's is once it has hung up or moved on to a retry. */
async function unanswered(init: RequestInit = {}): Promise<void> {
    try {
        await transcode(init);
    } catch {
        // Hung up on, or cut off by the test's cleanup.
    }
}

async function ffmpegPids(): Promise<number[]> {
    let text: string;
    try {
        text = await readFile(path.join(directory, 'ffmpeg.pids'), 'utf8');
    } catch {
        return [];
    }
    return text.split('\n').filter(Boolean).map(Number);
}

/** The id of the nth ffmpeg the server has started, once it has. */
async function ffmpegStarted(nth = 1): Promise<number> {
    return vi.waitFor(
        async () => {
            const pid = (await ffmpegPids())[nth - 1];
            if (pid === undefined) {
                throw new Error(`ffmpeg #${String(nth)} has not started`);
            }
            return pid;
        },
        { timeout: 5000, interval: 20 },
    );
}

function isRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function signal(pid: number, name: NodeJS.Signals): void {
    try {
        process.kill(pid, name);
    } catch {
        // Already gone.
    }
}

async function exited(child: ChildProcess): Promise<void> {
    if (child.exitCode === null && child.signalCode === null) {
        await once(child, 'exit');
    }
}

describe('transcoder server', () => {
    // Stands the buckets in: any GET answers a few bytes, and any PUT is taken.
    beforeEach(async () => {
        directory = await mkdtemp(path.join(tmpdir(), 'transcoder-test-'));
        bucket = createServer((request, response) => {
            request.resume();
            request.on('end', () => {
                response.end(request.method === 'GET' ? 'not really a movie' : '');
            });
        }).listen(0);
        await once(bucket, 'listening');
        bucketOrigin = `http://localhost:${String(portOf(bucket))}`;
    });

    afterEach(async () => {
        transcoder?.kill('SIGKILL');
        transcoder = undefined;
        for (const pid of await ffmpegPids()) {
            signal(pid, 'SIGKILL');
        }
        bucket.close();
        await rm(directory, { recursive: true, force: true });
    });

    it('reports what it made', async () => {
        await startTranscoder('encode');
        const response = await transcode();

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({ output: { codedWidth: 1920, codedHeight: 1080 } });
    });

    it.each([
        { name: 'rejects', ffmpeg: 'reject' },
        { name: 'crashes on', ffmpeg: 'crash' },
    ] as const)('answers 422, which the Worker never retries, for a file ffmpeg $name', async ({ ffmpeg }) => {
        await startTranscoder(ffmpeg);

        await expect(transcode()).resolves.toHaveProperty('status', 422);
    });

    it('answers 500, which the Worker retries, when ffmpeg is stopped by a signal', async () => {
        await startTranscoder('encode-forever');
        const answer = transcode();
        signal(await ffmpegStarted(), 'SIGTERM');

        await expect(answer).resolves.toHaveProperty('status', 500);
    });

    it('stops the encode when the Worker hangs up', async () => {
        await startTranscoder('encode-forever');
        const hangUp = new AbortController();
        const answer = unanswered({ signal: hangUp.signal });
        const pid = await ffmpegStarted();
        hangUp.abort();
        await answer;

        await vi.waitFor(() => {
            expect(isRunning(pid)).toBe(false);
        });
    });

    it("stops the encode of the Worker's last attempt when its retry arrives", async () => {
        await startTranscoder('encode-forever');
        void unanswered();
        const first = await ffmpegStarted(1);
        void unanswered();
        const second = await ffmpegStarted(2);

        await vi.waitFor(() => {
            expect(isRunning(first)).toBe(false);
        });

        expect(isRunning(second)).toBe(true);
    });

    it('answers 500 for a failure after it is told to stop, whatever ffmpeg logged, then exits', async () => {
        const server = await startTranscoder('encode-forever-quietly');
        const answer = transcode();
        const pid = await ffmpegStarted();
        server.kill('SIGTERM');
        signal(pid, 'SIGTERM');

        await expect(answer).resolves.toHaveProperty('status', 500);

        await exited(server);

        expect(server.exitCode).toBe(0);
    });

    it('exits when told to stop with nothing to finish', async () => {
        const server = await startTranscoder('encode');
        server.kill('SIGTERM');
        await exited(server);

        expect(server.exitCode).toBe(0);
    });
});
