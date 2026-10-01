// Brings over what the 2023 move from Zenphoto to AWS left behind: the day albums Zenphoto never published, each
// made here unpublished for an admin to look over and publish, and a photo hidden inside an album that was published.
// The words, names and order come from Zenphoto's database as `zenphoto.ts` translates them. Each file comes from
// Dropbox, read through the read-only rclone remote from the album's folder under `Photos/albums` or, failing that,
// `Photos/raw`, and goes in through the Worker's own upload, so the pipeline sizes it, reads its tags and makes its
// derived images.
//
// It takes the directory holding Zenphoto's `albums.jsonl` and `images.jsonl`, and touches only the albums named with
// --only, or with --all every unpublished album. A photo hidden inside a published album shows as soon as it is
// added, so --all leaves those out: such an album has to be named. It writes nothing without --go: a run without it
// finds every file and says what it would write. A rerun is a resume: it uploads only the photos the album does not
// list yet, leaves the words of an album that is already there as they are, and writes each photo's words again. An
// album's thumbnail and order are written until it is published, which is an admin having looked it over, and again
// only when the run adds photos to it.
// It stops at the first thing that goes wrong. Every write's outcome is a JSON line in `recover-<target>.jsonl` in
// the same directory.
//
// Usage: node api/scripts/recover-zenphoto.ts <zenphoto dir> --to local|staging|production
//            (--only <album path> ... | --all) [--go]
import path from 'node:path';
import * as valibot from 'valibot';
import { inScope } from './migration-run.ts';
import { jsonLines, parsedRun, recover } from './recovery.ts';
import { recoveryPlan } from './zenphoto.ts';

const USAGE =
    'Usage: node api/scripts/recover-zenphoto.ts <zenphoto dir> --to local|staging|production (--only <album path> ... | --all) [--go]';
const NULLABLE_TEXT = valibot.nullable(valibot.string());
const NULLABLE_NUMBER = valibot.nullable(valibot.number());
const ALBUM = valibot.object({
    id: valibot.number(),
    folder: valibot.string(),
    show: valibot.number(),
    desc: NULLABLE_TEXT,
    custom_data: NULLABLE_TEXT,
    thumb: NULLABLE_TEXT,
});
const IMAGE = valibot.object({
    albumid: valibot.number(),
    filename: valibot.string(),
    show: valibot.number(),
    title: NULLABLE_TEXT,
    desc: NULLABLE_TEXT,
    width: valibot.number(),
    height: valibot.number(),
    thumbX: NULLABLE_NUMBER,
    thumbY: NULLABLE_NUMBER,
    thumbW: NULLABLE_NUMBER,
    thumbH: NULLABLE_NUMBER,
    filesize: NULLABLE_NUMBER,
    tags: valibot.nullable(valibot.array(valibot.string())),
});

const run = await parsedRun(process.argv.slice(2), USAGE);
const plan = recoveryPlan(
    await jsonLines(path.join(run.directory, 'albums.jsonl'), ALBUM),
    await jsonLines(path.join(run.directory, 'images.jsonl'), IMAGE),
);
const { scope } = run;
const albums = plan.filter((album) =>
    album.draft ? inScope(scope, album.path) : !scope.all && scope.albums.includes(album.path),
);
console.log(
    `${String(albums.length)} of Zenphoto's ${String(plan.length)} albums with something unpublished; ${run.go ? `writing to ${run.to.site}` : `dry run for ${run.to.site}, writing nothing`}`,
);
for (const album of albums) {
    await recover(run, album);
}
