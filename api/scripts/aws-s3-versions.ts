// How each AWS media row's file stands in the originals bucket's version listing. The bucket is versioned, and the
// copy takes each key's current version, so a row naming any other version would be paired with the wrong file: an
// upload whose processing failed partway leaves the row on the old version while S3 holds the new one as current. A
// lifecycle rule deletes a version 24 days after it stops being current, so the row's version may be gone entirely.
// Nothing here touches the network, so a test can hold it still.

/** One version of one key, or a delete marker, as `list-object-versions` lists it. */
export interface ListedVersion {
    key: string;
    versionId: string;
    isLatest: boolean;
    deleteMarker: boolean;
    /** The file's size and ETag; a delete marker has neither. */
    size: number | null;
    etag: string | null;
}

/** A media row's path, without the leading slash S3 keys lack, and the version it names. */
export interface RowVersion {
    key: string;
    versionId: string | undefined;
}

export type Standing = 'current' | 'replaced' | 'gone' | 'deleted' | 'absent' | 'unnamed';

/** A row whose version is not its key's current one, and what is current instead, when anything is. */
export interface Finding {
    key: string;
    standing: Exclude<Standing, 'current'>;
    versionId: string | undefined;
    currentVersionId: string | null;
}

/**
 * Every row that is not on its key's current version, and every key with a current version that no row names. A row
 * is `replaced` when S3 still holds its version but another is current, `gone` when its version has expired,
 * `deleted` when the key's latest entry is a delete marker, `absent` when S3 has never held the key and `unnamed`
 * when the row names no version.
 */
export function compareVersions(
    rows: readonly RowVersion[],
    listing: readonly ListedVersion[],
): { findings: Finding[]; unclaimed: string[] } {
    const byKey = Map.groupBy(listing, (version) => version.key);
    const findings = rows.flatMap((row): Finding[] => {
        const versions = byKey.get(row.key) ?? [];
        const latest = versions.find((version) => version.isLatest);
        const currentVersionId = latest === undefined || latest.deleteMarker ? null : latest.versionId;
        const standing = standingOf(row, versions, latest, currentVersionId);
        return standing === 'current' ? [] : [{ key: row.key, standing, versionId: row.versionId, currentVersionId }];
    });
    const claimed = new Set(rows.map((row) => row.key));
    const unclaimed = listing
        .filter((version) => version.isLatest && !version.deleteMarker && !claimed.has(version.key))
        .map((version) => version.key);
    return { findings, unclaimed };
}

function standingOf(
    row: RowVersion,
    versions: readonly ListedVersion[],
    latest: ListedVersion | undefined,
    currentVersionId: string | null,
): Standing {
    if (versions.length === 0) {
        return 'absent';
    }
    if (row.versionId === undefined) {
        return 'unnamed';
    }
    if (row.versionId === currentVersionId) {
        return 'current';
    }
    if (latest?.deleteMarker === true) {
        return 'deleted';
    }
    return versions.some((version) => version.versionId === row.versionId) ? 'replaced' : 'gone';
}

/**
 * Each key's current version, the one a copy of the bucket takes; a key whose latest entry is a delete marker has none.
 */
export function currentVersions(listing: readonly ListedVersion[]): Map<string, ListedVersion> {
    return new Map(
        listing.filter((version) => version.isLatest && !version.deleteMarker).map((version) => [version.key, version]),
    );
}
