/**
 * A version id the constraint and the URL parser admit, read from a short label so a test can name its versions: the
 * label as Crockford base32 reads it, uppercased, I and L as 1, O as 0, hyphens dropped, and underscores with them,
 * padded on the left with zeros to a ULID's 26 characters. Loaded both in workerd and in Node.
 */
export function testVersionId(label: string): string {
    const folded = label.toUpperCase().replaceAll(/[IL]/gv, '1').replaceAll('O', '0').replaceAll(/[\-_]/gv, '');
    if (folded.length > 25 || !/^[\dA-HJKMNP-TV-Z]*$/v.test(folded)) {
        throw new Error(`No version id can be read from [${label}]`);
    }
    return folded.padStart(26, '0');
}
