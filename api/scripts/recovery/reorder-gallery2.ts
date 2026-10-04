// Puts the albums Gallery 2's admin ordered by hand back into that order, which `gallery2-order.ts` traces to today's
// names. Each album is read from the target first, and its order is written only when today's is not already Gallery
// 2's. A photo of Gallery 2's the album no longer has is left out and said so, since a few were culled; a photo the
// album has gained since follows, in name order, as the gallery shows an ordered album's later additions. An album
// shown in some order other than its names' today is written only when named with --only, since under --all nothing
// tells an order the copy from AWS wrote from one an admin set here since.
//
// It takes the directory holding Gallery 2's `items.jsonl` and the comparison's `matches.jsonl`, and touches only the
// albums named with --only, by their paths today, or with --all every one. It writes nothing without --go, and
// records each order it writes in `reorder-<target>.jsonl` in the directory.
//
// Usage: node api/scripts/recovery/reorder-gallery2.ts <gallery2 dir> --to local|staging|production
//            (--only <album path> ... | --all) [--go]
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import * as valibot from 'valibot';
import { GALLERY2_ITEM } from './gallery2.ts';
import { type HandOrdered, handOrdered, orderChange } from './gallery2-order.ts';
import { listedVersions, write } from './gallery-upload.ts';
import { inScope } from '../write-guard.ts';
import { jsonLines, parsedRun } from './recovery.ts';

const USAGE =
    'Usage: node api/scripts/recovery/reorder-gallery2.ts <gallery2 dir> --to local|staging|production (--only <album path> ... | --all) [--go]';
const MATCH = valibot.object({ g2: valibot.string(), zen: valibot.nullish(valibot.string()) });

const run = await parsedRun(process.argv.slice(2), USAGE);
const items = await jsonLines(path.join(run.directory, 'items.jsonl'), GALLERY2_ITEM);
const matches = (await jsonLines(path.join(run.directory, 'matches.jsonl'), MATCH)).flatMap(({ g2, zen }) =>
    zen === null || zen === undefined ? [] : [{ g2, zen }],
);
const { albums, leftAlone } = handOrdered(items, matches);
const inRun = albums.filter((album) => inScope(run.scope, album.path));
console.log(
    `${String(inRun.length)} of the ${String(albums.length)} albums Gallery 2 ordered by hand that the gallery has; ${run.go ? `writing to ${run.to.site}` : `dry run for ${run.to.site}, writing nothing`}`,
);
for (const { from, reason } of leftAlone.filter(() => run.scope.all)) {
    console.log(`    left alone: ${from}, ${reason}`);
}
let written = 0;
for (const album of inRun) {
    if (await reorder(album)) {
        written += 1;
    }
}
console.log(`\n${String(written)} orders ${run.go ? 'written' : 'to write'}`);

/** Says what the album's order changes, and with --go writes it; whether it was, or would be, written. */
async function reorder(album: HandOrdered): Promise<boolean> {
    const { to, target, go } = run;
    const listed = await listedVersions(to, album.path);
    console.log(`\n${album.path}: Gallery 2's ${album.from}, ${String(album.names.length)} photos`);
    if (listed === null) {
        console.log(`    not on ${target}, left alone`);
        return false;
    }
    const shown = [...listed.keys()];
    const change = orderChange(album, shown);
    if (change.collided.length > 0) {
        console.log(`    not written: the album seems to hold ${change.collided.join(', ')} under another name`);
        return false;
    }
    if (change.missing.length > 0) {
        console.log(`    no longer in the album, left out: ${change.missing.join(', ')}`);
    }
    if (change.moved === 0) {
        console.log("    already in Gallery 2's order");
        return false;
    }
    if (change.orderedToday && run.scope.all) {
        console.log(`    an order of its own today, left alone; name it with --only to replace it: ${shown.join(' ')}`);
        return false;
    }
    console.log(`    today${change.orderedToday ? ', an order of its own' : ''}: ${shown.join(' ')}`);
    console.log(`    Gallery 2: ${change.itemNames.join(' ')}`);
    console.log(
        `    ${String(change.moved)} photos move${change.added.length === 0 ? '' : `; added since and following in name order: ${change.added.join(', ')}`}`,
    );
    if (!go) {
        return true;
    }
    await write(to, 'PUT', `/api/album-order${album.path}`, { itemNames: change.itemNames });
    appendFileSync(
        path.join(run.directory, `reorder-${target}.jsonl`),
        `${JSON.stringify({ at: new Date().toISOString(), path: album.path, from: album.from, was: shown, itemNames: change.itemNames, added: change.added })}\n`,
    );
    console.log(`    ordered: ${to.site}${album.path.slice(0, -1)}`);
    return true;
}
