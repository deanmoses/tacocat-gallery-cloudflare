// Brings back the albums of Gallery 2's that the 2014 move to Zenphoto dropped, which `gallery2.ts` names: each is
// made here unpublished, as the day album the move would have made it, for an admin to look over and publish. The
// words and order come from Gallery 2's database; each file is the original from the day's folder in Dropbox, which
// `recovery.ts` uploads. Where the album was a sub-album, its parent's description links to it where Gallery 2 had
// it, and that link is pointed at the day album.
//
// It takes the directory holding Gallery 2's `items.jsonl`, and touches only the albums named with --only, by the
// path they come back at, or with --all every one. It writes nothing without --go.
//
// Usage: node api/scripts/recovery/recover-gallery2.ts <gallery2 dir> --to local|staging|production
//            (--only <album path> ... | --all) [--go]
import path from 'node:path';
import * as valibot from 'valibot';
import { LOST_ALBUMS, type MovedLink, recoveredAlbum } from './gallery2.ts';
import { write } from './gallery-upload.ts';
import { inScope } from '../write-guard.ts';
import { type Run, jsonLines, log, parsedRun, recover } from './recovery.ts';

const USAGE =
    'Usage: node api/scripts/recovery/recover-gallery2.ts <gallery2 dir> --to local|staging|production (--only <album path> ... | --all) [--go]';
const NULLABLE_TEXT = valibot.nullable(valibot.string());
const NULLABLE_NUMBER = valibot.nullable(valibot.number());
const ITEM = valibot.object({
    id: valibot.number(),
    parent: valibot.number(),
    type: valibot.string(),
    name: NULLABLE_TEXT,
    title: NULLABLE_TEXT,
    desc: NULLABLE_TEXT,
    order: NULLABLE_NUMBER,
    width: NULLABLE_NUMBER,
    height: NULLABLE_NUMBER,
});
const DESCRIBED = valibot.object({ description: valibot.optional(valibot.string()) });

const run = await parsedRun(process.argv.slice(2), USAGE);
const items = await jsonLines(path.join(run.directory, 'items.jsonl'), ITEM);
const lost = LOST_ALBUMS.filter((album) => inScope(run.scope, album.to));
console.log(
    `${String(lost.length)} of Gallery 2's ${String(LOST_ALBUMS.length)} lost albums; ${run.go ? `writing to ${run.to.site}` : `dry run for ${run.to.site}, writing nothing`}`,
);
for (const album of lost) {
    const recovered = recoveredAlbum(items, album);
    await recover(run, recovered.album);
    if (recovered.link !== null) {
        await moveLink(run, recovered.link);
    }
}

/** Points the link in the album's description at the recovered album, when the description still holds it. */
async function moveLink(to: Run, link: MovedLink): Promise<void> {
    const response = await fetch(`${to.to.site}/api/album${link.album}?consistency=primary`, {
        headers: { cookie: to.to.cookie },
    });
    const description = response.ok
        ? (valibot.parse(DESCRIBED, await response.json()).description ?? '')
        : ((await response.body?.cancel()) ?? '');
    if (!description.includes(link.from)) {
        console.log(`    ${link.album}: no ${link.from} in its description, left as it is`);
        return;
    }
    console.log(`    ${link.album}: ${link.from} in its description becomes ${link.to}`);
    if (!to.go) {
        return;
    }
    await write(to.to, 'PATCH', `/api/album${link.album}`, {
        description: description.split(link.from).join(link.to),
    });
    log(to, { path: link.album, outcome: 'link moved', from: link.from, to: link.to });
}
