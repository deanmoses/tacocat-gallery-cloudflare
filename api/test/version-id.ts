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

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A version id for a path: its 64-bit FNV-1a hash in Crockford base32, padded to a ULID's length. */
function pathVersionId(path: string): string {
    let hash = 0xcb_f2_9c_e4_84_22_23_25n;
    for (const byte of new TextEncoder().encode(path)) {
        hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x1_00_00_00_01_b3n);
    }
    const digits = hash.toString(32).replaceAll(/./gv, (digit) => CROCKFORD.charAt(Number.parseInt(digit, 32)));
    return digits.padStart(26, '0');
}

interface Row {
    itemType?: unknown;
    parentPath?: unknown;
    itemName?: unknown;
    versionId?: unknown;
}

/**
 * The row, given a version id read from its path when it is media that names none, since a file belongs to one item
 * only: rows spread from one fixture then each get a file of their own. A version id the row names, null included, is
 * kept.
 */
export function withVersionId<T extends Row>(row: T): T {
    const { itemType, parentPath, itemName, versionId } = row;
    const needsOne =
        itemType === 'media' &&
        versionId === undefined &&
        typeof parentPath === 'string' &&
        typeof itemName === 'string';
    return needsOne ? { ...row, versionId: pathVersionId(`${parentPath}${itemName}`) } : row;
}
