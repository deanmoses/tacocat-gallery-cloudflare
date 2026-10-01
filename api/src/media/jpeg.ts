const SOI = 0xd8;
const SOS = 0xda;
// APP1 holds EXIF and XMP, extended XMP included; APP13 holds Photoshop's IPTC block. The ICC profile (APP2) and
// Adobe's colour transform (APP14) stay, since they change how the pixels are drawn.
const METADATA: ReadonlySet<number> = new Set([0xe1, 0xed]);

/**
 * The JPEG without its EXIF, XMP and IPTC blocks, the pixels untouched; the bytes unchanged when they are not a JPEG
 * whose headers can be walked to the start of the scan, which is logged, since such a JPEG keeps whatever orientation
 * its XMP gives. The Images binding turns the pixels upright and drops EXIF's
 * orientation, but copies the XMP packet as it was, `tiff:Orientation` and all, and Safari, finding no EXIF
 * orientation, turns the image again by the XMP one. The blocks also carry the camera, the dates and the GPS position.
 */
export function withoutMetadata(jpeg: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
    if (jpeg[0] !== 0xff || jpeg[1] !== SOI) {
        return unstripped(jpeg, 'no start-of-image marker');
    }
    const kept: Uint8Array[] = [jpeg.subarray(0, 2)];
    let at = 2;
    for (;;) {
        const marker = jpeg[at + 1];
        if (jpeg[at] !== 0xff || marker === undefined) {
            return unstripped(jpeg, `no marker at byte ${String(at)}`);
        }
        if (marker === SOS) {
            kept.push(jpeg.subarray(at));
            break;
        }
        const length = ((jpeg[at + 2] ?? 0) << 8) | (jpeg[at + 3] ?? 0);
        const end = at + 2 + length;
        if (length < 2 || end > jpeg.length) {
            return unstripped(jpeg, `a segment of length ${String(length)} at byte ${String(at)}`);
        }
        if (!METADATA.has(marker)) {
            kept.push(jpeg.subarray(at, end));
        }
        at = end;
    }
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
