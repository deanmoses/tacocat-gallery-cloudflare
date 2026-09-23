// Transcodes one video per request: pulls the original from a presigned GET, pushes the MP4 and poster to
// Presigned PUTs, and reports what it probed. Output mirrors the MediaConvert job: progressive H.264 MP4,
// 5 Mbps cap, AAC 128k, first-frame JPEG poster.
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
    colorTransfer: string | undefined;
    codedWidth: number | undefined;
    codedHeight: number | undefined;
    rotation: number;
    audio: string | null;
}

/** The container's response; src/video.ts reads output's size, rotation and duration, and logs the rest. */
interface TranscodeReport {
    source: ProbeInfo;
    output: ProbeInfo & { bytes: number; hdrToneMapped: boolean };
    host: { cpus: number; model: string | undefined; memGiB: number };
    ms: { download: number; transcode: number; upload: number };
}

// Long side capped at 1920: at a 5 Mbps cap 4K looks no better, and scaling before the float tone-map is what keeps
// A 4K phone clip near real time.
const FIT = String.raw`scale=w=min(iw\,1920):h=min(ih\,1920):force_original_aspect_ratio=decrease:force_divisible_by=2`;
const TONE_MAP =
    'zscale=t=linear:npl=203,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv';

async function run(command: string, argv: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, argv);
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
        });
        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(`${command} exited ${String(code)}: ${stderr.slice(-2000)}`));
            }
        });
    });
}

async function probe(file: string): Promise<ProbeInfo> {
    const output = await run('ffprobe', [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_streams',
        '-show_format',
        file,
    ]);
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
        colorTransfer: stringField(video, 'color_transfer'),
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

async function download(url: string, file: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
        throw new Error(`GET original ${String(response.status)}`);
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
}

async function upload(file: string, url: string, type: string): Promise<void> {
    const put = await fetch(url, { method: 'PUT', body: await readFile(file), headers: { 'content-type': type } });
    if (put.ok) {
        return;
    }
    const text = await put.text();
    throw new Error(`PUT ${type} ${String(put.status)}: ${text}`);
}

function encodeArguments(input: string, filter: string, output: string): string[] {
    return [
        // Input, using every core for the filters.
        '-v',
        'error',
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
        filter,
        // H.264 High, capped at 5 Mbps like the MediaConvert job.
        '-c:v',
        'libx264',
        '-profile:v',
        'high',
        '-preset',
        'medium',
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

async function transcode(request: TranscodeRequest): Promise<TranscodeReport> {
    const directory = await mkdtemp(path.join(tmpdir(), 'tc-'));
    try {
        return await transcodeIn(directory, request);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

async function transcodeIn(directory: string, { src, mp4Put, posterPut }: TranscodeRequest): Promise<TranscodeReport> {
    const start = Date.now();
    const input = path.join(directory, 'input');
    await download(src, input);
    const downloaded = Date.now();
    const source = await probe(input);

    // HLG and PQ sources (iPhone HDR) look washed out unless tone-mapped to SDR BT.709.
    const isHdr = ['arib-std-b67', 'smpte2084'].includes(source.colorTransfer ?? '');
    const filter = isHdr ? `${FIT},${TONE_MAP},format=yuv420p` : `${FIT},format=yuv420p`;
    const mp4 = path.join(directory, 'out.mp4');
    await run('ffmpeg', encodeArguments(input, filter, mp4));
    const transcoded = Date.now();
    const poster = path.join(directory, 'poster.jpg');
    await run('ffmpeg', ['-v', 'error', '-i', mp4, '-frames:v', '1', '-q:v', '3', poster]);
    const output = await probe(mp4);

    await upload(mp4, mp4Put, 'video/mp4');
    await upload(poster, posterPut, 'image/jpeg');
    const uploaded = Date.now();
    const { size } = await stat(mp4);
    return {
        source,
        output: { ...output, bytes: size, hdrToneMapped: isHdr },
        host: { cpus: availableParallelism(), model: cpus()[0]?.model, memGiB: Math.round(totalmem() / 2 ** 30) },
        ms: { download: downloaded - start, transcode: transcoded - downloaded, upload: uploaded - transcoded },
    };
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === 'GET') {
        response.end('ok');
        return;
    }
    let body = '';
    for await (const chunk of request) {
        body += String(chunk);
    }
    try {
        const result = await transcode(readRequest(JSON.parse(body)));
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
    } catch (error) {
        response.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(error) }));
    }
}

createServer((request, response) => {
    void handle(request, response);
}).listen(8080);
