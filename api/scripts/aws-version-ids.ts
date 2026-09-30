// Which version id each AWS original gets. An id is random as well as timestamped, so once the copy has written an
// original under one, every later minting has to give that original the same id, or the copy would write it again
// under another and the first would belong to no row. So a minting reads the one before it: an original it already
// gave an id keeps it while S3's current version of the file and the path the copy puts it at are both unchanged. A
// photo replaced on AWS since is another file, and one whose path moved, as a new upload can move which of two
// same-named items gets `_2`, would carry the old path in its metadata, so each gets a new id and is copied again, as
// an upload replacing it here would be. Nothing here touches the network or the disk, so a test can hold it still.

/** An S3 file as the copy takes it: the version the listing shows as current, with its size and ETag. */
export interface AwsFile {
    awsVersionId: string;
    size: number;
    etag: string;
}

export interface Minted extends AwsFile {
    versionId: string;
    /** Where the copy puts the item. */
    path: string;
    mediaType: 'image' | 'video';
}

/** A media row as the minting sees it: where the copy puts it, and S3's current version of its file. */
export interface Candidate {
    awsPath: string;
    path: string | null;
    mediaType: 'image' | 'video';
    file: AwsFile | null;
}

export interface Minting {
    ids: Record<string, Minted>;
    /** Items the earlier minting had, same file and path, same id. */
    kept: string[];
    /** Items new since, or first minted now. */
    added: string[];
    /** Items whose file S3 now holds a different version of, which get a new id. */
    replaced: string[];
    /** Items whose file is the same but whose path moved, which get a new id. */
    moved: string[];
    /** Items the earlier minting had that the rows no longer do. */
    dropped: string[];
    /** Items no id can be given: the copy has no name for them, or S3 has no current file. */
    unminted: string[];
}

/** Every candidate's id, keeping those `earlier` gave where file and path are the same, and minting the rest. */
export function mintIds(
    candidates: readonly Candidate[],
    earlier: Readonly<Record<string, Minted>>,
    mint: () => string,
): Minting {
    const minting: Minting = { ids: {}, kept: [], added: [], replaced: [], moved: [], dropped: [], unminted: [] };
    for (const { awsPath, path, mediaType, file } of candidates) {
        if (path === null || file === null) {
            minting.unminted.push(awsPath);
            continue;
        }
        const before = earlier[awsPath];
        const sameFile = before?.awsVersionId === file.awsVersionId;
        const samePath = before?.path === path;
        minting.ids[awsPath] = {
            versionId: sameFile && samePath ? before.versionId : mint(),
            path,
            mediaType,
            ...file,
        };
        if (before === undefined) {
            minting.added.push(awsPath);
        } else if (sameFile) {
            (samePath ? minting.kept : minting.moved).push(awsPath);
        } else {
            minting.replaced.push(awsPath);
        }
    }
    const minted = new Set(Object.keys(minting.ids));
    minting.dropped = Object.keys(earlier).filter((awsPath) => !minted.has(awsPath));
    return minting;
}
