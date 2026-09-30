// Mints the version id of every AWS original, for the copy of the files and the import of the rows to share, so each
// row names the id its file was copied to. Each id is minted as an upload's is, stamped with the moment it was minted,
// and each entry records S3's current version of the file from the bucket's listing, which is the file a copy of the
// bucket takes, with its size and ETag, for the copy to check what it copies against. Given --from the file an earlier
// minting wrote, every original it gave an id keeps it while S3 holds the same file and the copy puts it at the same
// path, and only the new, the replaced and the moved get new ones (`aws-version-ids.ts`), so a later scan copies only
// what changed. The file it writes is never
// overwritten, since the copy may already have written originals under its ids: each minting writes a new one.
//
// Usage: node api/scripts/mint-version-ids.ts prod-items.json s3-versions.json version-ids.json
//            [--from earlier-version-ids.json]
import { writeFile } from 'node:fs/promises';
import { mintVersionId } from '../src/storage/keys.ts';
import { copiedMediaPath, copyPlan } from './aws-copy-plan.ts';
import { readListing } from './aws-s3-listing.ts';
import { type ListedVersion, currentVersions } from './aws-s3-versions.ts';
import { awsPath, readScan } from './aws-scan.ts';
import { type AwsFile, mintIds } from './aws-version-ids.ts';
import { value } from './migration-run.ts';
import { readVersionIds } from './version-ids-file.ts';

const USAGE =
    'Usage: node api/scripts/mint-version-ids.ts prod-items.json s3-versions.json version-ids.json [--from earlier-version-ids.json]';
const args = process.argv.slice(2);
const [scanFile, listingFile, idsFile] = args.filter(
    (arg, index) => !arg.startsWith('--') && args[index - 1] !== '--from',
);
if (scanFile === undefined || listingFile === undefined || idsFile === undefined) {
    throw new Error(USAGE);
}
const earlierFile = value(args, '--from');

const rows = await readScan(scanFile);
const plan = copyPlan(rows);
const current = currentVersions(await readListing(listingFile));
const minting = mintIds(
    rows
        .filter((row) => row.itemType === 'image')
        .map((row) => {
            const path = awsPath(row);
            return {
                awsPath: path,
                path: copiedMediaPath(plan, path),
                mediaType: row.mediaType === 'video' ? 'video' : 'image',
                file: fileOf(current.get(path.slice(1))),
            };
        }),
    earlierFile === undefined ? {} : await readVersionIds(earlierFile),
    () => mintVersionId(),
);

// `wx` fails when the file exists.
await writeFile(idsFile, `${JSON.stringify(minting.ids, null, 1)}\n`, { flag: 'wx' });
console.log(`${String(Object.keys(minting.ids).length)} version ids written to ${idsFile}`);
list(`kept from ${earlierFile ?? 'an earlier minting'}`, minting.kept, false);
list('new', minting.added, earlierFile !== undefined);
list('replaced on AWS since, given a new id', minting.replaced, true);
list('moved to another path since, given a new id', minting.moved, true);
list('in the earlier minting and no longer in the rows', minting.dropped, true);
list('given none, having no name the copy could give or no current file in S3', minting.unminted, true);

/** S3's current version of a file, as the copy takes it, or null when the listing holds none to take. */
function fileOf(version: ListedVersion | undefined): AwsFile | null {
    return version?.size === null || version?.etag === null || version === undefined
        ? null
        : { awsVersionId: version.versionId, size: version.size, etag: version.etag };
}

function list(what: string, paths: string[], showPaths: boolean): void {
    if (paths.length === 0) {
        return;
    }
    console.log(`${String(paths.length)} ${what}`);
    if (!showPaths) {
        return;
    }
    const shown = 5;
    for (const path of paths.slice(0, shown)) {
        console.log(`    ${path}`);
    }
    if (paths.length > shown) {
        console.log(`    … and ${String(paths.length - shown)} more`);
    }
}
