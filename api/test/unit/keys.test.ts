import { isVersionId } from '@tacocat-gallery/shared';
import { describe, expect, it } from 'vitest';
import { mintVersionId } from '../../src/storage/keys';

/** Crockford base32 as a number; exact only up to 53 bits, which is more than the comparison needs. */
function crockfordValue(text: string): number {
    let value = 0;
    for (const char of text) {
        value = value * 32 + '0123456789ABCDEFGHJKMNPQRSTVWXYZ'.indexOf(char);
    }
    return value;
}

describe(mintVersionId, () => {
    it('sorts a later id after an earlier one, whatever the random half', () => {
        const earlier = mintVersionId(Date.parse('2024-06-15T12:00:00.000Z'));
        const later = mintVersionId(Date.parse('2024-06-15T12:00:00.001Z'));

        expect([later, earlier].toSorted()).toStrictEqual([earlier, later]);
    });

    it('differs between two minted at the same moment', () => {
        const now = Date.parse('2024-06-15T12:00:00.000Z');

        expect(mintVersionId(now)).not.toBe(mintVersionId(now));
    });

    it('is a ULID, so any ULID tool decodes it and the constraint admits it', () => {
        const id = mintVersionId();

        expect(id).toMatch(/^[0-7][\dA-HJKMNP-TV-Z]{25}$/v);
        expect(isVersionId(id)).toBe(true);
    });

    it("encodes the timestamp as the spec's own example does", () => {
        // The spec's README: ulid(1469918176385) starts 01ARYZ6S41.
        expect(mintVersionId(1_469_918_176_385).slice(0, 10)).toBe('01ARYZ6S41');
    });

    it('keeps its random half apart from the last id, so one id of a batch gives away no other', () => {
        const now = Date.parse('2024-06-15T12:00:00.000Z');
        const [first, second] = [mintVersionId(now), mintVersionId(now)];
        const distance = Math.abs(crockfordValue(first.slice(10)) - crockfordValue(second.slice(10)));

        expect(first.slice(0, 10)).toBe(second.slice(0, 10));
        expect(distance).toBeGreaterThan(1000);
    });
});
