// Brings back the static gallery's photos that `static-gallery.ts` names: each new album made here unpublished, for an
// admin to look over and publish, and each other photo added to its album. `recovery.ts` uploads each file from
// Dropbox where the day's folder holds the album's photos, and otherwise from the static gallery's own copy under
// `files/`, by its path in `pix/`, such as `files/2002/04/02/images/bruno1.jpg`; Dropbox holds none of these.
//
// It takes the directory holding the static gallery's `items.jsonl`, and touches only the albums named with --only,
// by their gallery paths, or with --all every one. It writes nothing without --go.
//
// Usage: node api/scripts/recovery/recover-static.ts <pix dir> --to local|staging|production
//            (--only <album path> ... | --all) [--go]
import path from 'node:path';
import { STATIC_ALBUMS, STATIC_ITEM, recoveredStaticAlbum } from './static-gallery.ts';
import { inScope } from '../write-guard.ts';
import { jsonLines, parsedRun, recover } from './recovery.ts';

const USAGE =
    'Usage: node api/scripts/recovery/recover-static.ts <pix dir> --to local|staging|production (--only <album path> ... | --all) [--go]';

const run = await parsedRun(process.argv.slice(2), USAGE);
const items = await jsonLines(path.join(run.directory, 'items.jsonl'), STATIC_ITEM);
const albums = STATIC_ALBUMS.filter((album) => inScope(run.scope, album.to)).map((album) =>
    recoveredStaticAlbum(items, album),
);
console.log(
    `${String(albums.length)} of the static gallery's ${String(STATIC_ALBUMS.length)} albums, ${String(albums.reduce((sum, album) => sum + album.media.length, 0))} photos; ${run.go ? `writing to ${run.to.site}` : `dry run for ${run.to.site}, writing nothing`}`,
);
for (const album of albums) {
    await recover(run, album);
}
