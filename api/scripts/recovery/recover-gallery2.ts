// Brings back what the 2014 move to Zenphoto dropped from Gallery 2, which `gallery2.ts` names. Each lost album is
// made here unpublished, as the day album the move would have made it, for an admin to look over and publish; each
// lost photo goes into its published album; and each summary, title and caption goes onto the album or photo that lacks it,
// unless an admin has written one there since. The words and order come from Gallery 2's database. `recovery.ts`
// uploads each file: the original from the day's folder in Dropbox, or where Dropbox has none, Gallery 2's own copy
// under `files/`, by its Gallery 2 path, such as `files/2008/02-03/pk/collin.jpg`. Where the album was a sub-album,
// its parent's description links to it where Gallery 2 had it, and that link is pointed at the day album.
//
// It takes the directory holding Gallery 2's `items.jsonl`, and touches only the albums named with --only, by the
// path they come back at, or with --all every one. It writes nothing without --go.
//
// Usage: node api/scripts/recovery/recover-gallery2.ts <gallery2 dir> --to local|staging|production
//            (--only <album path> ... | --all) [--go]
import path from 'node:path';
import * as valibot from 'valibot';
import {
    LOST_ALBUMS,
    LOST_PHOTOS,
    LOST_WORDS,
    type LostWords,
    type MovedLink,
    lostWords,
    recoveredAlbum,
    recoveredPhotos,
} from './gallery2.ts';
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
    summary: NULLABLE_TEXT,
    desc: NULLABLE_TEXT,
    order: NULLABLE_NUMBER,
    albumOrder: NULLABLE_TEXT,
    width: NULLABLE_NUMBER,
    height: NULLABLE_NUMBER,
});
const DESCRIBED = valibot.object({ description: valibot.optional(valibot.string()) });
const WORDED = valibot.object({
    summary: valibot.optional(valibot.string()),
    children: valibot.optional(
        valibot.array(
            valibot.object({
                itemName: valibot.string(),
                title: valibot.optional(valibot.string()),
                description: valibot.optional(valibot.string()),
            }),
        ),
    ),
});

const run = await parsedRun(process.argv.slice(2), USAGE);
const items = await jsonLines(path.join(run.directory, 'items.jsonl'), ITEM);
const lost = LOST_ALBUMS.filter((album) => inScope(run.scope, album.to));
const photos = recoveredPhotos(items, LOST_PHOTOS).filter((album) => inScope(run.scope, album.path));
const words = lostWords(items, LOST_WORDS).filter((lostWord) => inScope(run.scope, lostWord.path));
console.log(
    `${String(lost.length)} of Gallery 2's ${String(LOST_ALBUMS.length)} lost albums, lost photos in ${String(photos.length)} albums, and ${String(words.length)} summaries, titles and captions; ${run.go ? `writing to ${run.to.site}` : `dry run for ${run.to.site}, writing nothing`}`,
);
for (const album of lost) {
    const recovered = recoveredAlbum(items, album);
    await recover(run, recovered.album);
    if (recovered.link !== null) {
        await moveLink(run, recovered.link);
    }
}
for (const album of photos) {
    await recover(run, album);
}
if (words.length > 0) {
    console.log('');
}
for (const lostWord of words) {
    await writeLostWords(run, lostWord);
}

/** Writes the summary, title or caption onto its album or photo, when the field there is still empty. */
async function writeLostWords(to: Run, lostWord: LostWords): Promise<void> {
    const isAlbum = lostWord.field === 'summary';
    const media = path.posix.basename(lostWord.path);
    const albumPath = isAlbum ? lostWord.path : `${path.posix.dirname(lostWord.path)}/`;
    const response = await fetch(`${to.to.site}/api/album${albumPath}?consistency=primary`, {
        headers: { cookie: to.to.cookie },
    });
    if (!response.ok) {
        throw new Error(`${albumPath} is not on ${to.target}: ${String(response.status)} ${await response.text()}`);
    }
    const album = valibot.parse(WORDED, await response.json());
    const child = album.children?.find((item) => item.itemName === media);
    if (!isAlbum && child === undefined) {
        throw new Error(`${lostWord.path} is not on ${to.target}`);
    }
    const there = (isAlbum ? album.summary : child?.[lostWord.field === 'title' ? 'title' : 'description']) ?? '';
    if (there === lostWord.text) {
        console.log(`${lostWord.path}: its ${lostWord.field} is there already`);
        return;
    }
    if (there !== '') {
        console.log(`${lostWord.path}: has a ${lostWord.field} of its own, left as it is: ${there}`);
        return;
    }
    console.log(`${lostWord.path}: ${lostWord.field} becomes ${lostWord.text}`);
    if (!to.go) {
        return;
    }
    await write(to.to, 'PATCH', `/api/${isAlbum ? 'album' : 'media'}${lostWord.path}`, {
        [lostWord.field]: lostWord.text,
    });
    log(to, { path: lostWord.path, outcome: `${lostWord.field} written` });
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
