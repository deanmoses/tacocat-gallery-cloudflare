// Transcodes one video per request: pulls the original from a presigned GET, pushes the MP4 and poster to
// Presigned PUTs, and reports what it probed. Output mirrors the MediaConvert job: progressive H.264 MP4,
// 5 Mbps cap, AAC 128k, the source's colour tags, first-frame JPEG poster.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { availableParallelism, cpus, tmpdir, totalmem } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

interface TranscodeRequest {
    src: string;
    mp4Put: string;
    posterPut: string;
}

/** What ffprobe says about a file, as reported back to the Worker. */
interface ProbeInfo {
    container: string | undefined;
    durationSeconds: number;
    codec: string | undefined;
    profile: string | undefined;
    pixFmt: string | undefined;
    colorPrimaries: string | undefined;
    colorTransfer: string | undefined;
    colorSpace: string | undefined;
    codedWidth: number | undefined;
    codedHeight: number | undefined;
    rotation: number;
    audio: string | null;
}

/** The container's response; src/media/transcoder.ts reads output's size, rotation and duration, and logs the rest. */
interface TranscodeReport {
    source: ProbeInfo;
    output: ProbeInfo & { bytes: number; posterToneMapped: boolean };
    host: { cpus: number; model: string | undefined; memGiB: number };
    ms: { download: number; transcode: number; upload: number };
}

// Long side capped at 1920: at a 5 Mbps cap 4K looks no better, and scaling first keeps a 4K phone clip's decode
// the only work done at 4K.
const FIT = String.raw`scale=w=min(iw\,1920):h=min(ih\,1920):force_original_aspect_ratio=decrease:force_divisible_by=2`;
const TONE_MAP =
    'zscale=t=linear:npl=203,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv';

/** ffmpeg or ffprobe rejected the file, so the same file would fail the same way again. */
class MediaError extends Error {
    public constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'MediaError';
    }
}

async function run(command: string, argv: string[], signal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, argv, { signal });
        child.on('error', reject);
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
        });
        child.on('close', (code, killedBy) => {
            if (code === 0) {
                resolve(stdout);
                return;
            }
            const message = `${command} exited ${String(code ?? killedBy)}: ${stderr.slice(-2000)}`;
            // A stop signal, as when the platform stops or replaces the instance, is no fault of the file; ffmpeg
            // catches it and exits 255, so only its log tells the two apart.
            reject(stderr.includes('received signal') ? new Error(message) : new MediaError(message));
        });
    });
}

async function probe(file: string, signal: AbortSignal): Promise<ProbeInfo> {
    const output = await run(
        'ffprobe',
        ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
        signal,
    );
    const info: unknown = JSON.parse(output);
    const streams = arrayField(info, 'streams');
    const video = streams.find((stream) => stringField(stream, 'codec_type') === 'video');
    const audio = streams.find((stream) => stringField(stream, 'codec_type') === 'audio');
    const format = property(info, 'format');
    const rotations = arrayField(video, 'side_data_list').map((data) => numberField(data, 'rotation'));
    return {
        container: stringField(format, 'format_name'),
        durationSeconds: Number(stringField(format, 'duration')),
        codec: stringField(video, 'codec_name'),
        profile: stringField(video, 'profile'),
        pixFmt: stringField(video, 'pix_fmt'),
        colorPrimaries: stringField(video, 'color_primaries'),
        colorTransfer: stringField(video, 'color_transfer'),
        colorSpace: stringField(video, 'color_space'),
        codedWidth: numberField(video, 'width'),
        codedHeight: numberField(video, 'height'),
        rotation: rotations.find((rotation) => rotation !== undefined) ?? 0,
        audio: stringField(audio, 'codec_name') ?? null,
    };
}

// Parsed JSON is opaque until checked. This image has no node_modules, so these stand in for a schema library.

/** `value[key]`, or undefined when `value` is not an object that has it. */
function property(value: unknown, key: string): unknown {
    return typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
    const field = property(value, key);
    return typeof field === 'string' ? field : undefined;
}

function numberField(value: unknown, key: string): number | undefined {
    const field = property(value, key);
    return typeof field === 'number' ? field : undefined;
}

function arrayField(value: unknown, key: string): unknown[] {
    const field = property(value, key);
    return Array.isArray(field) ? field : [];
}

function readRequest(json: unknown): TranscodeRequest {
    const original = stringField(json, 'src');
    const mp4Put = stringField(json, 'mp4Put');
    const posterPut = stringField(json, 'posterPut');
    if (original === undefined || mp4Put === undefined || posterPut === undefined) {
        throw new Error('expected src, mp4Put and posterPut URLs');
    }
    return { src: original, mp4Put, posterPut };
}

async function download(url: string, file: string, signal: AbortSignal): Promise<void> {
    const response = await fetch(url, { signal });
    if (!response.ok || !response.body) {
        throw new Error(`GET original ${response.status}`);
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(file), { signal });
}

async function upload(file: string, url: string, type: string, signal: AbortSignal): Promise<void> {
    const body = await readFile(file);
    const put = await fetch(url, { method: 'PUT', body, headers: { 'content-type': type }, signal });
    if (put.ok) {
        return;
    }
    const text = await put.text();
    throw new Error(`PUT ${type} ${put.status}: ${text}`);
}

/**
 * The source's colour tags, for the MP4 to carry unchanged as MediaConvert's defaults do. A browser converts an HLG or
 * PQ video to its own screen, and Safari and iOS do it Apple's way, which a tone-map baked in here cannot match; the
 * video is 8-bit, as H.264 at 10 bits plays almost nowhere, and a gradient may band, as it does on the AWS site.
 */
function colourTags({ colorPrimaries, colorTransfer, colorSpace }: ProbeInfo): string[] {
    const tags: [string, string | undefined][] = [
        ['-color_primaries', colorPrimaries],
        ['-color_trc', colorTransfer],
        ['-colorspace', colorSpace],
    ];
    return tags.flatMap(([flag, value]) => (value === undefined || value === 'unknown' ? [] : [flag, value]));
}

function encodeArguments(input: string, source: ProbeInfo, output: string): string[] {
    return [
        // Input, using every core for the filters. Info rather than error, since ffmpeg says it caught a signal only at
        // info, and the stream summary it adds is short.
        '-v',
        'info',
        '-nostats',
        '-hide_banner',
        '-filter_threads',
        String(availableParallelism()),
        '-i',
        input,
        // First video track and the first audio track if there is one; iPhones add more of both.
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-vf',
        `${FIT},format=yuv420p`,
        ...colourTags(source),
        // H.264 High, capped at 5 Mbps like the MediaConvert job. On a two-minute 1080p60 screen recording, veryfast
        // took 30% less time than medium for a slightly smaller file, at an SSIM 0.0004 lower.
        '-c:v',
        'libx264',
        '-profile:v',
        'high',
        '-preset',
        'veryfast',
        '-crf',
        '21',
        '-maxrate',
        '5M',
        '-bufsize',
        '10M',
        // AAC 128k, and the index up front so playback starts before the download ends.
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        output,
    ];
}

async function transcode(request: TranscodeRequest, signal: AbortSignal): Promise<TranscodeReport> {
    const directory = await mkdtemp(path.join(tmpdir(), 'tc-'));
    try {
        return await transcodeIn(directory, request, signal);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

async function transcodeIn(
    directory: string,
    { src, mp4Put, posterPut }: TranscodeRequest,
    signal: AbortSignal,
): Promise<TranscodeReport> {
    const start = Date.now();
    const input = path.join(directory, 'input');
    await download(src, input, signal);
    const downloaded = Date.now();
    const source = await probe(input, signal);

    const mp4 = path.join(directory, 'out.mp4');
    await run('ffmpeg', encodeArguments(input, source, mp4), signal);
    const transcoded = Date.now();
    // A JPEG cannot carry HLG or PQ, so an HDR source's poster is tone-mapped to SDR BT.709, or it looks washed out.
    // Made from the source rather than the MP4, since the MP4 is still HDR.
    const isHdr = ['arib-std-b67', 'smpte2084'].includes(source.colorTransfer ?? '');
    const posterFilter = isHdr ? `${FIT},${TONE_MAP},format=yuv420p` : `${FIT},format=yuv420p`;
    const poster = path.join(directory, 'poster.jpg');
    await run(
        'ffmpeg',
        ['-v', 'error', '-i', input, '-frames:v', '1', '-vf', posterFilter, '-q:v', '3', poster],
        signal,
    );
    const output = await probe(mp4, signal);

    await upload(mp4, mp4Put, 'video/mp4', signal);
    await upload(poster, posterPut, 'image/jpeg', signal);
    const uploaded = Date.now();
    const { size } = await stat(mp4);
    return {
        source,
        output: { ...output, bytes: size, posterToneMapped: isHdr },
        host: { cpus: availableParallelism(), model: cpus()[0]?.model, memGiB: Math.round(totalmem() / 2 ** 30) },
        ms: { download: downloaded - start, transcode: transcoded - downloaded, upload: uploaded - transcoded },
    };
}

/** The encode under way, which a newer request or a hang-up ends. */
let current: AbortController | undefined;
/** Whether the platform has asked the container to stop, as it does to replace or put an instance to sleep. */
let stopping = false;

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === 'GET') {
        response.end('ok');
        return;
    }
    let body = '';
    for await (const chunk of request) {
        body += String(chunk);
    }
    // An instance serves one version, so a second request is the Worker's retry, and the attempt before it has nobody
    // waiting; nor has an encode whose request the Worker hung up on, as when its step timed out. Either would take the
    // CPU from the encode someone is waiting for.
    current?.abort();
    const job = new AbortController();
    current = job;
    response.on('close', () => {
        if (!response.writableFinished) {
            job.abort();
        }
        if (current !== job) {
            return;
        }
        current = undefined;
        if (stopping) {
            process.exit(0);
        }
    });
    try {
        const result = await transcode(readRequest(JSON.parse(body)), job.signal);
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
    } catch (error) {
        // 422 tells the Worker not to retry; anything else (network, storage, the instance stopping, which may have
        // stopped ffmpeg without its saying so) is worth another attempt.
        const status = error instanceof MediaError && !stopping ? 422 : 500;
        response
            .writeHead(status, { 'content-type': 'application/json' })
            .end(JSON.stringify({ error: String(error) }));
    }
}

// The platform waits up to 15 minutes after this before it kills the container, so the current request is answered
// first.
process.on('SIGTERM', () => {
    stopping = true;
    if (current === undefined) {
        process.exit(0);
    }
});

createServer((request, response) => {
    void handle(request, response);
}).listen(Number(process.env['PORT'] ?? 8080));
