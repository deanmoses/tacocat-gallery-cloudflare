import { type Query, ftsQuery } from '../src/gallery/query';

/** A photo but for where it goes and which file it is, small enough that a crop is easy to reckon. */
export const IMAGE = { itemType: 'media', mediaType: 'image', width: 4, height: 3 } as const;

/** The bytes of a file from `api/fixtures/`, which a `?inline` import hands over as a data URL. */
export function fixtureBytes(dataUrl: string): Uint8Array<ArrayBuffer> {
    return Uint8Array.fromBase64(dataUrl.slice(dataUrl.indexOf(',') + 1));
}

/** Search terms compiled to the FTS5 query the search runs, for terms known to compile. */
export function compiledQuery(terms: string): Query {
    const result = ftsQuery(terms);
    if ('error' in result) throw new Error(result.error);
    return result.query;
}

/**
 * A JPEG's header segments, named by their markers as `APP1` or `DQT`, and its scan, the compressed pixels from the
 * start-of-scan marker on: read independently of the code under test.
 */
export function jpegParts(jpeg: Uint8Array): { segments: string[]; scan: Uint8Array } {
    const names: Record<number, string> = { 0xc0: 'SOF0', 0xc2: 'SOF2', 0xc4: 'DHT', 0xdb: 'DQT', 0xdd: 'DRI' };
    const segments: string[] = [];
    let at = 2;
    while (jpeg[at] === 0xff && jpeg[at + 1] !== 0xda) {
        const marker = jpeg[at + 1] ?? 0;
        segments.push(
            marker >= 0xe0 && marker <= 0xef
                ? `APP${String(marker - 0xe0)}`
                : (names[marker] ?? `0x${marker.toString(16)}`),
        );
        at += 2 + (((jpeg[at + 2] ?? 0) << 8) | (jpeg[at + 3] ?? 0));
    }
    return { segments, scan: jpeg.subarray(at) };
}
