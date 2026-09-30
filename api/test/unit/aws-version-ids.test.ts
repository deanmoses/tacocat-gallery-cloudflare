import { describe, expect, it } from 'vitest';
import { type Candidate, mintIds } from '../../scripts/aws-version-ids.ts';

const file = { awsVersionId: 's3-v1', size: 1000, etag: '"md5-1"' };
const felix: Candidate = { awsPath: '/2001/06-15/felix.jpg', path: '/2001/06-15/felix', mediaType: 'image', file };

/** Ids in the order they are minted, so a test can say which item got which. */
function counter(): () => string {
    let next = 0;
    return () => {
        next += 1;
        return `new-${String(next)}`;
    };
}

describe(mintIds, () => {
    it('mints an id for every item, recording the version S3 holds as current, with its size and ETag', () => {
        const minting = mintIds([felix], {}, counter());

        expect(minting.ids).toStrictEqual({
            '/2001/06-15/felix.jpg': {
                versionId: 'new-1',
                path: '/2001/06-15/felix',
                mediaType: 'image',
                awsVersionId: 's3-v1',
                size: 1000,
                etag: '"md5-1"',
            },
        });
        expect(minting.added).toStrictEqual(['/2001/06-15/felix.jpg']);
    });

    // A later scan has to keep the ids the copy already wrote originals under, or it would copy them all again
    it('keeps the id an earlier minting gave an original whose file is the same', () => {
        const earlier = mintIds([felix], {}, counter()).ids;

        const minting = mintIds([felix], earlier, () => 'minted-again');

        expect(minting.ids['/2001/06-15/felix.jpg']?.versionId).toBe('new-1');
        expect(minting.kept).toStrictEqual(['/2001/06-15/felix.jpg']);
    });

    it('gives a new id to a photo replaced on AWS since, which is another file', () => {
        const earlier = mintIds([felix], {}, counter()).ids;

        const replacement = { awsVersionId: 's3-v2', size: 2000, etag: '"md5-2"' };

        const minting = mintIds([{ ...felix, file: replacement }], earlier, () => 'minted-again');

        expect(minting.ids['/2001/06-15/felix.jpg']).toStrictEqual({
            versionId: 'minted-again',
            path: '/2001/06-15/felix',
            mediaType: 'image',
            ...replacement,
        });
        expect(minting.replaced).toStrictEqual(['/2001/06-15/felix.jpg']);
    });

    // A new upload can move which of two same-named items gets _2, and the copied object's metadata names its path
    it('gives a new id to an item whose path moved, so its copy names the path it has', () => {
        const earlier = mintIds([felix], {}, counter()).ids;

        const minting = mintIds([{ ...felix, path: '/2001/06-15/felix_2' }], earlier, () => 'minted-again');

        expect(minting.ids['/2001/06-15/felix.jpg']?.versionId).toBe('minted-again');
        expect(minting.moved).toStrictEqual(['/2001/06-15/felix.jpg']);
    });

    it('lists what the earlier minting had and the rows no longer do', () => {
        const earlier = mintIds([felix], {}, counter()).ids;

        expect(mintIds([], earlier, counter()).dropped).toStrictEqual(['/2001/06-15/felix.jpg']);
    });

    it('mints nothing for an item the copy has no name for, or whose file S3 no longer holds', () => {
        const minting = mintIds(
            [
                { ...felix, awsPath: '/2001/06-15/.jpg', path: null },
                { ...felix, awsPath: '/2001/06-15/gone.jpg', file: null },
            ],
            {},
            counter(),
        );

        expect(minting.ids).toStrictEqual({});
        expect(minting.unminted).toStrictEqual(['/2001/06-15/.jpg', '/2001/06-15/gone.jpg']);
    });
});
