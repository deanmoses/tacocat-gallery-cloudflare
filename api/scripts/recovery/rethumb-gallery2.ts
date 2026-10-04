// Gives back the thumbnails Gallery 2's admin cut, which the 2014 move lost and `gallery2-thumbnails.ts` traces to
// today's names. Each album is read from the target first. A crop is written only onto a photo with none, since one
// there is an admin's later choice, and only where the photo is the shape it was in Gallery 2, which a re-edited file
// is not.
//
// It takes the directory holding Gallery 2's `items.jsonl` and `derivatives.jsonl` and the comparison's
// `matches.jsonl`, and touches only the albums named with --only, by their paths today, or with --all every one. It
// writes nothing without --go, and records each write, with what it replaced, in `rethumb-<target>.jsonl` in the
// directory.
//
// Usage: node api/scripts/recovery/rethumb-gallery2.ts <gallery2 dir> --to local|staging|production
//            (--only <album path> ... | --all) [--go]
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import * as valibot from 'valibot';
import { GALLERY2_ITEM } from './gallery2.ts';
import { GALLERY2_DERIVATIVE, type LostCrop, cropOutcome, lostCrops } from './gallery2-thumbnails.ts';
import { listedCrops, write } from './gallery-upload.ts';
import { inScope } from '../write-guard.ts';
import { jsonLines, parsedRun } from './recovery.ts';

const USAGE =
    'Usage: node api/scripts/recovery/rethumb-gallery2.ts <gallery2 dir> --to local|staging|production (--only <album path> ... | --all) [--go]';
const MATCH = valibot.object({ g2: valibot.string(), zen: valibot.nullish(valibot.string()) });

const LEFT_ALONE = {
    done: "already Gallery 2's",
    missing: 'not in the album, culled or renamed since',
    cropped: 'cut since by an admin',
    reshaped: 'another shape than in Gallery 2, so the crop would not line up',
};

const run = await parsedRun(process.argv.slice(2), USAGE);
const items = await jsonLines(path.join(run.directory, 'items.jsonl'), GALLERY2_ITEM);
const derivatives = await jsonLines(path.join(run.directory, 'derivatives.jsonl'), GALLERY2_DERIVATIVE);
const matches = (await jsonLines(path.join(run.directory, 'matches.jsonl'), MATCH)).flatMap(({ g2, zen }) =>
    zen === null || zen === undefined ? [] : [{ g2, zen }],
);
const { crops, unmatched } = lostCrops(items, derivatives, matches);
const albums = [...new Set(crops.map(albumOf))].filter((album) => inScope(run.scope, album)).toSorted();
console.log(
    `${String(crops.length)} thumbnails Gallery 2's admin cut, in ${String(albums.length)} albums; ${run.go ? `writing to ${run.to.site}` : `dry run for ${run.to.site}, writing nothing`}`,
);
if (unmatched.length > 0) {
    console.log(`    cut for photos the comparison matched to nothing, left alone: ${unmatched.join(', ')}`);
}
let written = 0;
for (const album of albums) {
    written += await recut(
        album,
        crops.filter((crop) => albumOf(crop) === album),
    );
}
console.log(`\n${String(written)} crops ${run.go ? 'written' : 'to write'}`);

/** Says what the album's crops change, and with --go writes them; how many were, or would be, written. */
async function recut(album: string, albumCrops: LostCrop[]): Promise<number> {
    const { to, target, go } = run;
    const listed = await listedCrops(to, album);
    console.log(`\n${album}`);
    if (listed === null) {
        console.log(`    not on ${target}, left alone`);
        return 0;
    }
    let count = 0;
    for (const lost of albumCrops) {
        const name = nameOf(lost.path);
        const outcome = cropOutcome(lost, listed.get(name));
        if (outcome !== 'write') {
            console.log(`    ${name}: ${LEFT_ALONE[outcome]}, left alone`);
            continue;
        }
        console.log(`    ${name}: crop ${cropText(lost)} from Gallery 2's ${lost.from}`);
        count += 1;
        if (go) {
            await write(to, 'PATCH', `/api/thumb${lost.path}`, lost.crop);
            record({ path: lost.path, from: lost.from, crop: lost.crop });
        }
    }
    return count;
}

function record(entry: Record<string, unknown>): void {
    appendFileSync(
        path.join(run.directory, `rethumb-${run.target}.jsonl`),
        `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
    );
}

function albumOf({ path: at }: LostCrop): string {
    return at.slice(0, at.lastIndexOf('/') + 1);
}

function nameOf(at: string): string {
    return at.slice(at.lastIndexOf('/') + 1);
}

function cropText({ crop }: LostCrop): string {
    return [crop.x, crop.y, crop.width, crop.height].map((figure) => `${figure.toFixed(1)}%`).join(' ');
}
