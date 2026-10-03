// The AWS originals bucket's version listing, saved as the CLI writes it:
//
//   aws s3api list-object-versions --bucket tacocat-gallery-sam-prod-original-images --output json > s3-versions.json
import { readFile } from 'node:fs/promises';
import * as valibot from 'valibot';
import type { ListedVersion } from './aws-s3-versions.ts';

// AWS's JSON names its fields in PascalCase, so each is read by its name and renamed.
const RECORD = valibot.record(valibot.string(), valibot.unknown());
const ENTRY = valibot.pipe(
    RECORD,
    valibot.transform((raw) => ({
        key: raw['Key'],
        versionId: raw['VersionId'],
        isLatest: raw['IsLatest'],
        size: raw['Size'] ?? null,
        etag: raw['ETag'] ?? null,
    })),
    valibot.object({
        key: valibot.string(),
        versionId: valibot.string(),
        isLatest: valibot.boolean(),
        size: valibot.nullable(valibot.number()),
        etag: valibot.nullable(valibot.string()),
    }),
);
const LISTING = valibot.pipe(
    RECORD,
    valibot.transform((listing) => ({
        versions: listing['Versions'] ?? [],
        deleteMarkers: listing['DeleteMarkers'] ?? [],
    })),
    valibot.object({ versions: valibot.array(ENTRY), deleteMarkers: valibot.array(ENTRY) }),
);

/** Every version and delete marker in the listing, each marker saying so. */
export async function readListing(file: string): Promise<ListedVersion[]> {
    const listed = valibot.parse(LISTING, JSON.parse(await readFile(file, 'utf8')));
    return [
        ...listed.versions.map((version) => ({ ...version, deleteMarker: false })),
        ...listed.deleteMarkers.map((marker) => ({ ...marker, deleteMarker: true })),
    ];
}
