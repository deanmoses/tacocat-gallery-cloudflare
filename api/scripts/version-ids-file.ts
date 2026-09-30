// The file `mint-version-ids.ts` writes and the copy of the files and the import of the rows read: each media row's
// AWS path, and what the copy makes of it, with the S3 version of its file the copy takes.
import { readFile } from 'node:fs/promises';
import * as valibot from 'valibot';
import { isVersionId } from '@tacocat-gallery/shared';

const ENTRY = valibot.object({
    versionId: valibot.pipe(valibot.string(), valibot.check(isVersionId, 'is not a version id')),
    path: valibot.string(),
    mediaType: valibot.picklist(['image', 'video']),
    awsVersionId: valibot.string(),
    size: valibot.pipe(valibot.number(), valibot.integer()),
    etag: valibot.string(),
});
const FILE = valibot.record(valibot.string(), ENTRY);

export type VersionIds = valibot.InferOutput<typeof FILE>;

export async function readVersionIds(file: string): Promise<VersionIds> {
    return valibot.parse(FILE, JSON.parse(await readFile(file, 'utf8')));
}
