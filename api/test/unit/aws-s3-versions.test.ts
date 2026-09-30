import { describe, expect, it } from 'vitest';
import { type ListedVersion, compareVersions } from '../../scripts/aws-s3-versions.ts';

const version = (key: string, versionId: string, isLatest: boolean): ListedVersion => ({
    key,
    versionId,
    isLatest,
    deleteMarker: false,
    size: 1000,
    etag: '"md5"',
});

describe(compareVersions, () => {
    it("finds nothing for a row on its key's current version", () => {
        const listing = [version('2001/06-15/felix.jpg', 'v2', true), version('2001/06-15/felix.jpg', 'v1', false)];

        expect(compareVersions([{ key: '2001/06-15/felix.jpg', versionId: 'v2' }], listing)).toStrictEqual({
            findings: [],
            unclaimed: [],
        });
    });

    // An upload whose processing failed partway: S3 holds the new file as current, the row the old one
    it('finds a row left on a replaced version, and names the current one', () => {
        const listing = [version('2001/06-15/felix.jpg', 'v2', true), version('2001/06-15/felix.jpg', 'v1', false)];

        expect(compareVersions([{ key: '2001/06-15/felix.jpg', versionId: 'v1' }], listing).findings).toStrictEqual([
            { key: '2001/06-15/felix.jpg', standing: 'replaced', versionId: 'v1', currentVersionId: 'v2' },
        ]);
    });

    it('finds a row whose version has expired, and one whose key S3 has never held', () => {
        const listing = [version('2001/06-15/felix.jpg', 'v2', true)];

        expect(
            compareVersions(
                [
                    { key: '2001/06-15/felix.jpg', versionId: 'v1' },
                    { key: '2001/06-15/cake.jpg', versionId: 'v1' },
                ],
                listing,
            ).findings,
        ).toStrictEqual([
            { key: '2001/06-15/felix.jpg', standing: 'gone', versionId: 'v1', currentVersionId: 'v2' },
            { key: '2001/06-15/cake.jpg', standing: 'absent', versionId: 'v1', currentVersionId: null },
        ]);
    });

    it("finds a row whose key's latest entry is a delete marker, even on the version before it", () => {
        const listing = [
            {
                key: '2001/06-15/felix.jpg',
                versionId: 'm1',
                isLatest: true,
                deleteMarker: true,
                size: null,
                etag: null,
            },
            version('2001/06-15/felix.jpg', 'v1', false),
        ];

        expect(compareVersions([{ key: '2001/06-15/felix.jpg', versionId: 'v1' }], listing).findings).toStrictEqual([
            { key: '2001/06-15/felix.jpg', standing: 'deleted', versionId: 'v1', currentVersionId: null },
        ]);
    });

    it('finds a row that names no version', () => {
        const listing = [version('2001/06-15/felix.jpg', 'v1', true)];

        expect(
            compareVersions([{ key: '2001/06-15/felix.jpg', versionId: undefined }], listing).findings,
        ).toStrictEqual([
            { key: '2001/06-15/felix.jpg', standing: 'unnamed', versionId: undefined, currentVersionId: 'v1' },
        ]);
    });

    it('lists a current file no row names, but not a deleted one', () => {
        const listing = [
            version('2001/06-15/felix.jpg', 'v1', true),
            version('2001/06-15/stray.jpg', 'v1', true),
            { key: '2001/06-15/gone.jpg', versionId: 'm1', isLatest: true, deleteMarker: true, size: null, etag: null },
        ];

        expect(compareVersions([{ key: '2001/06-15/felix.jpg', versionId: 'v1' }], listing).unclaimed).toStrictEqual([
            '2001/06-15/stray.jpg',
        ]);
    });
});
