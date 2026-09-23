// Transcodes one video per request: pulls the original from a presigned GET, pushes the MP4 and poster to
// presigned PUTs, and reports what it probed. Output mirrors the MediaConvert job: progressive H.264 MP4,
// 5 Mbps cap, AAC 128k, first-frame JPEG poster.
import { spawn } from 'node:child_process';
import { readFile, rm, mkdtemp, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { availableParallelism, cpus, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';

const run = (cmd, args) =>
    new Promise((resolve, reject) => {
        const p = spawn(cmd, args);
        let out = '';
        let err = '';
        p.stdout.on('data', (d) => (out += d));
        p.stderr.on('data', (d) => (err += d));
        p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-2000)}`))));
    });

async function probe(file) {
    const info = JSON.parse(await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]));
    const v = info.streams.find((s) => s.codec_type === 'video');
    const rotation = Number(v?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0);
    return {
        container: info.format.format_name,
        durationSeconds: Number(info.format.duration),
        codec: v?.codec_name,
        profile: v?.profile,
        pixFmt: v?.pix_fmt,
        colorTransfer: v?.color_transfer,
        codedWidth: v?.width,
        codedHeight: v?.height,
        rotation,
        audio: info.streams.find((s) => s.codec_type === 'audio')?.codec_name ?? null,
    };
}

async function transcode({ src, mp4Put, posterPut }) {
    const dir = await mkdtemp(join(tmpdir(), 'tc-'));
    const t = { start: Date.now() };
    try {
        const input = join(dir, 'input');
        const res = await fetch(src);
        if (!res.ok) throw new Error(`GET original ${res.status}`);
        await import('node:fs').then(({ createWriteStream }) =>
            import('node:stream/promises').then(({ pipeline }) =>
                import('node:stream').then(({ Readable }) => pipeline(Readable.fromWeb(res.body), createWriteStream(input))),
            ),
        );
        t.downloaded = Date.now();
        const source = await probe(input);

        // HLG and PQ sources (iPhone HDR) look washed out unless tone-mapped to SDR BT.709.
        const hdr = ['arib-std-b67', 'smpte2084'].includes(source.colorTransfer);
        // Long side capped at 1920: at a 5 Mbps cap 4K looks no better, and scaling before the float tone-map
        // is what keeps a 4K phone clip near real time.
        const fit = 'scale=w=min(iw\\,1920):h=min(ih\\,1920):force_original_aspect_ratio=decrease:force_divisible_by=2';
        const vf = hdr
            ? `${fit},zscale=t=linear:npl=203,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p`
            : `${fit},format=yuv420p`;
        const mp4 = join(dir, 'out.mp4');
        await run('ffmpeg', [
            '-v', 'error', '-filter_threads', String(availableParallelism()), '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf,
            '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'medium', '-crf', '21', '-maxrate', '5M', '-bufsize', '10M',
            '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', mp4,
        ]);
        t.transcoded = Date.now();
        const poster = join(dir, 'poster.jpg');
        await run('ffmpeg', ['-v', 'error', '-i', mp4, '-frames:v', '1', '-q:v', '3', poster]);
        const output = await probe(mp4);

        for (const [file, url, type] of [[mp4, mp4Put, 'video/mp4'], [poster, posterPut, 'image/jpeg']]) {
            const put = await fetch(url, { method: 'PUT', body: await readFile(file), headers: { 'content-type': type } });
            if (!put.ok) throw new Error(`PUT ${type} ${put.status}: ${await put.text()}`);
        }
        t.uploaded = Date.now();
        return {
            source,
            output: { ...output, bytes: (await stat(mp4)).size, hdrToneMapped: hdr },
            host: { cpus: availableParallelism(), model: cpus()[0]?.model, memGiB: Math.round(totalmem() / 2 ** 30) },
            ms: { download: t.downloaded - t.start, transcode: t.transcoded - t.downloaded, upload: t.uploaded - t.transcoded },
        };
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

createServer(async (req, res) => {
    if (req.method === 'GET') return res.end('ok');
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
        const result = await transcode(JSON.parse(body));
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
    } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(e) }));
    }
}).listen(8080);
