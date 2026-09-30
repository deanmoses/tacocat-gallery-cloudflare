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
