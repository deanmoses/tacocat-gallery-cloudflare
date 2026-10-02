const SOI = 0xd8;
const SOS = 0xda;
// APP1 holds EXIF and XMP, extended XMP included; APP13 holds Photoshop's IPTC block. The ICC profile (APP2) and
// Adobe's colour transform (APP14) stay, since they change how the pixels are drawn.
const METADATA: ReadonlySet<number> = new Set([0xe1, 0xed]);

interface Segment {
    marker: number;
    start: number;
    end: number;
}

/** The segments ahead of the scan and where the scan starts, or why the headers cannot be walked that far. */
type Headers = { segments: Segment[]; scan: number } | { error: string };

function walk(jpeg: Uint8Array): Headers {
    if (jpeg[0] !== 0xff || jpeg[1] !== SOI) {
        return { error: 'no start-of-image marker' };
    }
    const segments: Segment[] = [];
    let at = 2;
    for (;;) {
        const marker = jpeg[at + 1];
        if (jpeg[at] !== 0xff || marker === undefined) {
            return { error: `no marker at byte ${String(at)}` };
        }
        if (marker === SOS) {
            return { segments, scan: at };
        }
        const length = ((jpeg[at + 2] ?? 0) << 8) | (jpeg[at + 3] ?? 0);
        const end = at + 2 + length;
        if (length < 2 || end > jpeg.length) {
            return { error: `a segment of length ${String(length)} at byte ${String(at)}` };
        }
        segments.push({ marker, start: at, end });
        at = end;
    }
}

/**
 * Where the scan starts in `jpeg`, which may be only the start of a file, or null when it is not a JPEG whose headers
 * can be walked that far in what is there. Everything ExifReader reads of a JPEG, its size included, comes before it.
 */
export function scanStart(jpeg: Uint8Array): number | null {
    const headers = walk(jpeg);
    return 'error' in headers ? null : headers.scan;
}

/**
 * The JPEG without its EXIF, XMP and IPTC blocks, the pixels untouched; the bytes unchanged when they are not a JPEG
 * whose headers can be walked to the start of the scan, which is logged, since such a JPEG keeps whatever orientation
 * its XMP gives. The Images binding turns the pixels upright and drops EXIF's
 * orientation, but copies the XMP packet as it was, `tiff:Orientation` and all, and Safari, finding no EXIF
 * orientation, turns the image again by the XMP one. The blocks also carry the camera, the dates and the GPS position.
 */
export function withoutMetadata(jpeg: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
    const headers = walk(jpeg);
    if ('error' in headers) {
        return unstripped(jpeg, headers.error);
    }
    const kept: Uint8Array[] = [
        jpeg.subarray(0, 2),
        ...headers.segments
            .filter(({ marker }) => !METADATA.has(marker))
            .map(({ start, end }) => jpeg.subarray(start, end)),
        jpeg.subarray(headers.scan),
    ];
    const stripped = new Uint8Array(kept.reduce((total, part) => total + part.length, 0));
    let written = 0;
    for (const part of kept) {
        stripped.set(part, written);
        written += part.length;
    }
    return stripped;
}

function unstripped(jpeg: Uint8Array<ArrayBuffer>, reason: string): Uint8Array<ArrayBuffer> {
    console.warn({ event: 'jpeg_metadata_kept', reason, bytes: jpeg.length });
    return jpeg;
}
