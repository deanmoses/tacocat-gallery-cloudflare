import croppedHeicDataUrl from '../../fixtures/CroppedHeic.heic?inline';
import jpgDataUrl from '../../fixtures/FullMetadata.jpg?inline';
import heicDataUrl from '../../fixtures/FullMetadataHeic.heic?inline';
import { describe, expect, it } from 'vitest';
import { heifSize } from '../../src/media/heif';
import { fixtureBytes } from '../gallery';

const heic = fixtureBytes(croppedHeicDataUrl);

describe(heifSize, () => {
    // Its tiles and its 2016x1512 auxiliary image each have an `ispe` of their own.
    it("reads the primary item's size, not another item's", () => {
        expect(heifSize(fixtureBytes(heicDataUrl))).toStrictEqual({ width: 4032, height: 3024 });
    });

    it('reads the size from the head of a file cut off in its pixels', () => {
        expect(heifSize(heic.slice(0, 8192))).toStrictEqual({ width: 1000, height: 600 });
    });

    // No fixture has a 64-bit box size, a version 1 `pitm` or `ipma`, wide property indexes or these turns.
    it.each([
        { irot: 1, size: { width: 3000, height: 4000 } },
        { irot: 2, size: { width: 4000, height: 3000 } },
        // Only the low two bits are the angle; the rest are reserved.
        { irot: 0b1111_1101, size: { width: 3000, height: 4000 } },
    ])('reads the boxes in their wider forms, with irot $irot', ({ irot, size }) => {
        expect(heifSize(widestHeif(irot))).toStrictEqual(size);
    });

    it.each([
        { name: 'a JPEG', bytes: fixtureBytes(jpgDataUrl) },
        { name: 'a HEIC cut off inside its metadata', bytes: heic.slice(0, 600) },
        { name: 'no bytes at all', bytes: new Uint8Array(0) },
    ])('has no size for $name', ({ bytes }) => {
        expect(heifSize(bytes)).toBeNull();
    });
});

/** Boxes alone, no pixels: a 4000x3000 primary item turned by `irot`, and a 100x100 item ahead of it in `ipma`. */
function widestHeif(irot: number): Uint8Array {
    const primary = 70_000;
    const ispe = box('ispe', fullBox(0, 0), u32(4000), u32(3000));
    const otherIspe = box('ispe', fullBox(0, 0), u32(100), u32(100));
    const rotation = box('irot', Uint8Array.of(irot));
    const ipma = box(
        'ipma',
        fullBox(1, 1),
        u32(2),
        u32(5),
        Uint8Array.of(1),
        u16(0x80_02),
        u32(primary),
        Uint8Array.of(2),
        u16(0x80_01),
        u16(0x80_03),
    );
    const meta = concat(
        fullBox(0, 0),
        box('pitm', fullBox(1, 0), u32(primary)),
        box('iprp', box('ipco', ispe, otherIspe, rotation), ipma),
    );
    const largeMeta = concat(u32(1), ascii('meta'), u32(0), u32(16 + meta.length), meta);
    return concat(box('ftyp', ascii('heic'), u32(0), ascii('mif1')), largeMeta);
}

function box(type: string, ...content: Uint8Array[]): Uint8Array {
    const body = concat(...content);
    return concat(u32(8 + body.length), ascii(type), body);
}

function fullBox(version: number, flags: number): Uint8Array {
    return concat(Uint8Array.of(version), Uint8Array.of(flags >> 16, (flags >> 8) & 0xff, flags & 0xff));
}

function u16(value: number): Uint8Array {
    return Uint8Array.of(value >> 8, value & 0xff);
}

function u32(value: number): Uint8Array {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value);
    return bytes;
}

function ascii(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}

function concat(...parts: Uint8Array[]): Uint8Array {
    const whole = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let at = 0;
    for (const part of parts) {
        whole.set(part, at);
        at += part.length;
    }
    return whole;
}
