// Where each AWS video's playable MP4 and poster frame come from and go to. A row written through `PUT /api/item`
// never reaches the transcoder, so a copied video plays only if the MP4 and poster MediaConvert made on AWS are copied
// beside it, under the version id its original was copied under. AWS keyed them by the row's own version id, and the
// copy takes S3's current version of the original, so a video whose two differ would get the MP4 of one upload beside
// the original of another, and is refused. Nothing here touches the network or the disk, so a test can hold it still.
import { posterKey, videoKey } from '../src/storage/keys.ts';
import type { VersionIds } from './version-ids-file.ts';

/** A video row as AWS stored it: its path there, with its extension, and the version id its derivatives are under. */
export interface AwsVideo {
    awsPath: string;
    awsVersionId: unknown;
}

export interface DerivativeCopy {
    awsPath: string;
    /** Where the copy puts the video. */
    path: string;
    /** In the AWS derived bucket. */
    source: string;
    /** In the target's derived bucket. */
    target: string;
    contentType: 'video/mp4' | 'image/jpeg';
}

export interface DerivativePlan {
    copies: DerivativeCopy[];
    /**
     * Videos with no version id of their own on AWS, or none minted, or whose row names another version than the one
     * the copy takes, whose derivatives cannot be found, placed, or trusted to be of the file copied.
     */
    unpaired: string[];
}

export function derivativeCopies(videos: readonly AwsVideo[], ids: Readonly<VersionIds>): DerivativePlan {
    const plan: DerivativePlan = { copies: [], unpaired: [] };
    for (const { awsPath, awsVersionId } of videos) {
        const minted = ids[awsPath];
        if (typeof awsVersionId !== 'string' || minted?.mediaType !== 'video' || minted.awsVersionId !== awsVersionId) {
            plan.unpaired.push(awsPath);
            continue;
        }
        const prefix = `i${awsPath}/${awsVersionId}`;
        const { path, versionId } = minted;
        plan.copies.push(
            {
                awsPath,
                path,
                source: `${prefix}/video-transcoded`,
                target: videoKey(versionId),
                contentType: 'video/mp4',
            },
            {
                awsPath,
                path,
                source: `${prefix}/video-poster`,
                target: posterKey(versionId),
                contentType: 'image/jpeg',
            },
        );
    }
    return plan;
}
