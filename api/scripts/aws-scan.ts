// The AWS gallery's rows, from a DynamoDB scan of the items table saved as the CLI writes it:
//
//   aws dynamodb scan --table-name tacocat-gallery-sam-prod-items --output json > prod-items.json
import { readFile } from 'node:fs/promises';
import * as valibot from 'valibot';
import { albumPath, mediaPath } from '@tacocat-gallery/shared';

// A DynamoDB attribute value, as the CLI prints it: one key naming the type.
const ATTRIBUTE: valibot.GenericSchema<unknown, unknown> = valibot.lazy(() =>
    valibot.union([
        valibot.pipe(
            valibot.object({ S: valibot.string() }),
            valibot.transform((value): unknown => value.S),
        ),
        valibot.pipe(
            valibot.object({ N: valibot.string() }),
            valibot.transform((value): unknown => Number(value.N)),
        ),
        valibot.pipe(
            valibot.object({ BOOL: valibot.boolean() }),
            valibot.transform((value): unknown => value.BOOL),
        ),
        valibot.pipe(
            valibot.object({ NULL: valibot.boolean() }),
            valibot.transform((): unknown => null),
        ),
        valibot.pipe(
            valibot.object({ L: valibot.array(ATTRIBUTE) }),
            valibot.transform((value): unknown => value.L),
        ),
        valibot.pipe(
            valibot.object({ SS: valibot.array(valibot.string()) }),
            valibot.transform((value): unknown => value.SS),
        ),
        valibot.pipe(
            valibot.object({ M: valibot.record(valibot.string(), ATTRIBUTE) }),
            valibot.transform((value): unknown => value.M),
        ),
    ]),
);
// The CLI's output: an object whose Items are the rows.
const SCAN = valibot.pipe(
    valibot.record(valibot.string(), valibot.unknown()),
    valibot.transform((scan): unknown => scan['Items']),
    valibot.array(valibot.record(valibot.string(), ATTRIBUTE)),
);

// An item as AWS stored it: 'image' is any media, and a video says so in mediaType. Every field is optional here so
// that a row missing one reaches the Worker and is refused there, where the refusal is the finding.
const AWS_ITEM = valibot.looseObject({
    parentPath: valibot.optional(valibot.string()),
    itemName: valibot.optional(valibot.string()),
    itemType: valibot.optional(valibot.string()),
    mediaType: valibot.optional(valibot.string()),
    title: valibot.optional(valibot.unknown()),
    description: valibot.optional(valibot.unknown()),
    summary: valibot.optional(valibot.unknown()),
    tags: valibot.optional(valibot.unknown()),
    published: valibot.optional(valibot.unknown()),
    versionId: valibot.optional(valibot.unknown()),
    dimensions: valibot.optional(valibot.looseObject({ width: valibot.unknown(), height: valibot.unknown() })),
    duration: valibot.optional(valibot.unknown()),
    thumbnail: valibot.optional(valibot.unknown()),
});
export type AwsItem = valibot.InferOutput<typeof AWS_ITEM>;

export async function readScan(file: string): Promise<AwsItem[]> {
    return valibot.parse(SCAN, JSON.parse(await readFile(file, 'utf8'))).map((raw) => valibot.parse(AWS_ITEM, raw));
}

/** The row's path on AWS: an album's with its trailing slash, a media item's with its extension. */
export function awsPath(row: AwsItem): string {
    return (row.itemType === 'album' ? albumPath : mediaPath)(row.parentPath ?? '', row.itemName ?? '');
}
