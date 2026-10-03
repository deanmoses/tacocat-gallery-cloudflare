import type { Size } from '@tacocat-gallery/shared';

interface Box {
    type: string;
    /** Where the box's content starts, after its size and type. */
    start: number;
    end: number;
}

/**
 * The ISO BMFF boxes between `start` and `end` of `file`, which may be only part of one: a box running past what is
 * there ends the walk, so it yields the boxes that are whole.
 */
function* boxes(file: DataView, start: number, end: number): Generator<Box> {
    let at = start;
    while (at + 8 <= end) {
        let size = file.getUint32(at);
        let header = 8;
        if (size === 1) {
            if (at + 16 > end) {
                return;
            }
            size = Number(file.getBigUint64(at + 8));
            header = 16;
        } else if (size === 0) {
            size = end - at;
        }
        if (size < header || at + size > end) {
            return;
        }
        const type = String.fromCodePoint(
            file.getUint8(at + 4),
            file.getUint8(at + 5),
            file.getUint8(at + 6),
            file.getUint8(at + 7),
        );
        yield { type, start: at + header, end: at + size };
        at += size;
    }
}

function child(file: DataView, parent: Box, type: string): Box | undefined {
    return boxes(file, parent.start, parent.end).find((box) => box.type === type);
}

/**
 * The size of a HEIF image, a HEIC or an AVIF, as it is shown: its primary item's `ispe`, turned by its `irot`. Null
 * for bytes that are not one, or whose primary item states no size. Its EXIF size is the camera's and outlives a crop
 * in an editor that leaves EXIF alone, and the item's `irot` is what a decoder turns it by, whatever EXIF orientation
 * says. A `clap` crop is not applied.
 */
export function heifSize(bytes: Uint8Array): Size | null {
    const file = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const top = [...boxes(file, 0, file.byteLength)];
    const meta = top[0]?.type === 'ftyp' ? top.find((box) => box.type === 'meta') : undefined;
    if (meta === undefined) {
        return null;
    }
    // `meta` is a full box: its children follow a version and flags.
    const items = { ...meta, start: meta.start + 4 };
    const pitm = child(file, items, 'pitm');
    const iprp = child(file, items, 'iprp');
    const ipco = iprp === undefined ? undefined : child(file, iprp, 'ipco');
    if (pitm === undefined || iprp === undefined || ipco === undefined || pitm.end - pitm.start < 6) {
        return null;
    }
    // `pitm` is a full box: a version 0 one names the item in two bytes, a later one in four.
    const idBytes = file.getUint8(pitm.start) === 0 ? 2 : 4;
    if (pitm.end - pitm.start < 4 + idBytes) {
        return null;
    }
    const primary = idBytes === 2 ? file.getUint16(pitm.start + 4) : file.getUint32(pitm.start + 4);
    const properties = [...boxes(file, ipco.start, ipco.end)];
    const associated = [...boxes(file, iprp.start, iprp.end)]
        .filter((box) => box.type === 'ipma')
        .flatMap((ipma) => associations(file, ipma, primary))
        .map((index) => properties[index - 1])
        .filter((box) => box !== undefined);
    const ispe = associated.find((box) => box.type === 'ispe');
    if (ispe === undefined || ispe.end - ispe.start < 12) {
        return null;
    }
    const width = file.getUint32(ispe.start + 4);
    const height = file.getUint32(ispe.start + 8);
    if (width === 0 || height === 0) {
        return null;
    }
    const irot = associated.find((box) => box.type === 'irot');
    // `irot` turns the image anticlockwise by its low two bits times a quarter turn.
    const quarterTurns = irot === undefined || irot.end <= irot.start ? 0 : file.getUint8(irot.start) & 0b11;
    return quarterTurns % 2 === 1 ? { width: height, height: width } : { width, height };
}

/** The one-based `ipco` indexes an `ipma` box associates with `item`, empty when it names none or is cut short. */
function associations(file: DataView, ipma: Box, item: number): number[] {
    if (ipma.end - ipma.start < 4) {
        return [];
    }
    const version = file.getUint8(ipma.start);
    const wideIndexes = (file.getUint8(ipma.start + 3) & 1) === 1;
    let at = ipma.start + 4;
    const read = (bytes: 1 | 2 | 4): number | null => {
        if (at + bytes > ipma.end) {
            return null;
        }
        const from = at;
        at += bytes;
        if (bytes === 1) {
            return file.getUint8(from);
        }
        return bytes === 2 ? file.getUint16(from) : file.getUint32(from);
    };
    const entries = read(4) ?? 0;
    for (let entry = 0; entry < entries; entry++) {
        const id = read(version < 1 ? 2 : 4);
        const count = read(1);
        if (id === null || count === null) {
            return [];
        }
        const indexes: number[] = [];
        for (let association = 0; association < count; association++) {
            const value = read(wideIndexes ? 2 : 1);
            if (value === null) {
                return [];
            }
            // The top bit marks the property essential; the rest is its index.
            indexes.push(value & (wideIndexes ? 0x7f_ff : 0x7f));
        }
        if (id === item) {
            return indexes;
        }
    }
    return [];
}
