// Checks every AWS media row's version id against the originals bucket's version listing, and reports each row that
// is not on its key's current version, which the copy would pair with the wrong file or none, and each current file
// no row names. The rows come from a DynamoDB scan of the AWS gallery's table, and the listing from the CLI:
//
//   aws s3api list-object-versions --bucket tacocat-gallery-sam-prod-original-images --output json > s3-versions.json
//
// Usage: node api/scripts/check-s3-versions.ts prod-items.json s3-versions.json [--paths]
import { readFile } from 'node:fs/promises';
import * as valibot from 'valibot';
import { readListing } from './aws-s3-listing.ts';
import { type Finding, compareVersions } from './aws-s3-versions.ts';

const [itemsFile, versionsFile] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
if (itemsFile === undefined || versionsFile === undefined) {
    throw new Error('Usage: node api/scripts/check-s3-versions.ts prod-items.json s3-versions.json [--paths]');
}
const showEveryPath = process.argv.includes('--paths');
const PATHS_SHOWN = 10;

const RECORD = valibot.record(valibot.string(), valibot.unknown());
const text = valibot.optional(valibot.object({ S: valibot.string() }));
// Only the fields that say where a media row's file is, as the DynamoDB CLI prints them.
const SCAN = valibot.pipe(
    RECORD,
    valibot.transform((scan): unknown => scan['Items']),
    valibot.array(valibot.looseObject({ parentPath: text, itemName: text, itemType: text, versionId: text })),
);

const items = valibot.parse(SCAN, JSON.parse(await readFile(itemsFile, 'utf8')));
const listing = await readListing(versionsFile);

const rows = items
    .filter((item) => item.itemType?.S !== 'album')
    .map((item) => ({
        key: `${item.parentPath?.S ?? ''}${item.itemName?.S ?? ''}`.replace(/^\//v, ''),
        versionId: item.versionId?.S,
    }));
const { findings, unclaimed } = compareVersions(rows, listing);

console.log(
    `${rows.length} media rows; ${listing.filter((entry) => !entry.deleteMarker).length} versions and ${listing.filter((entry) => entry.deleteMarker).length} delete markers ` +
        `of ${new Set(listing.map((entry) => entry.key)).size} keys in the bucket`,
);
console.log();
console.log(`${rows.length - findings.length} rows on their key's current version, ${findings.length} not`);
for (const [standing, group] of Map.groupBy(findings, (finding) => finding.standing)) {
    console.log();
    console.log(`${group.length}× ${standing}`);
    for (const finding of group) {
        console.log(`    ${describe(finding)}`);
    }
}
console.log();
console.log(`${unclaimed.length} current files no row names`);
const shown = showEveryPath ? unclaimed : unclaimed.slice(0, PATHS_SHOWN);
for (const key of shown) {
    console.log(`    ${key}`);
}
if (shown.length < unclaimed.length) {
    console.log(`    … and ${unclaimed.length - shown.length} more (--paths lists them)`);
}

function describe(finding: Finding): string {
    return `${finding.key}: row ${finding.versionId ?? 'none'}, current ${finding.currentVersionId ?? 'none'}`;
}
