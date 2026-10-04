// Points the links in descriptions that hold the old galleries' addresses where Moses picked, as
// `description-links.ts` applies a pick. Each description is read from the target first, and a pick whose link is no
// longer there, or already points where the pick says, is left alone, so an edit made since stands and a rerun writes
// nothing twice.
//
// It takes the directory holding the contact sheet's `picks.txt`, and touches only the descriptions of the albums and
// photos inside the albums named with --only, or with --all every one. It writes nothing without --go, and records
// each description it writes, with what it was before, in `relink-<target>.jsonl` in the directory.
//
// Usage: node api/scripts/recovery/relink-descriptions.ts <sheet dir> --to local|staging|production
//            (--only <album path> ... | --all) [--go]
import { appendFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parsePath } from '@tacocat-gallery/shared';
import * as valibot from 'valibot';
import { type Relink, type RelinkOutcome, parseRelinks, relinked } from './description-links.ts';
import { write } from './gallery-upload.ts';
import { inScope } from '../write-guard.ts';
import { parsedRun } from './recovery.ts';

const USAGE =
    'Usage: node api/scripts/recovery/relink-descriptions.ts <sheet dir> --to local|staging|production (--only <album path> ... | --all) [--go]';
const DESCRIPTION = valibot.optional(valibot.nullable(valibot.string()));
const ALBUM = valibot.object({
    description: DESCRIPTION,
    children: valibot.optional(valibot.array(valibot.object({ itemName: valibot.string(), description: DESCRIPTION }))),
});

const SAID: Record<RelinkOutcome, string> = {
    rewritten: '',
    already: 'already points there, left alone',
    absent: 'not in the description any more, left alone',
};

const run = await parsedRun(process.argv.slice(2), USAGE);
const picks = parseRelinks(await readFile(path.join(run.directory, 'picks.txt'), 'utf8'));
const sources = [...new Set(picks.map((pick) => pick.source))]
    .filter((source) => inScope(run.scope, source))
    .toSorted();
console.log(
    `${String(picks.length)} picks in ${String(new Set(picks.map((pick) => pick.source)).size)} descriptions, ${String(sources.length)} in scope; ${run.go ? `writing to ${run.to.site}` : `dry run for ${run.to.site}, writing nothing`}`,
);
let written = 0;
for (const source of sources) {
    written += await relink(
        source,
        picks.filter((pick) => pick.source === source),
    );
}
console.log(`\n${String(written)} descriptions ${run.go ? 'written' : 'to write'}`);

/** Says what the picks change in the source's description, and with --go writes it; 1 when it is, or would be, written. */
async function relink(source: string, sourcePicks: Relink[]): Promise<number> {
    console.log(`\n${source}`);
    const before = await descriptionOf(source);
    if (before === null) {
        console.log(`    not on ${run.target}, left alone`);
        return 0;
    }
    let after = before;
    const applied: string[] = [];
    for (const pick of sourcePicks) {
        const { description, outcome } = relinked(after, pick);
        after = description;
        const change = pick.kind === 'point' ? `${pick.from} → ${pick.to}` : `${pick.from} taken off`;
        console.log(`    ${pick.id}: ${change}${outcome === 'rewritten' ? '' : `: ${SAID[outcome]}`}`);
        if (outcome === 'rewritten') {
            applied.push(pick.id);
        }
    }
    if (after === before) {
        return 0;
    }
    if (run.go) {
        const kind = parsePath(source)?.kind === 'media' ? 'media' : 'album';
        await write(run.to, 'PATCH', `/api/${kind}${source}`, { description: after });
        record({ path: source, picks: applied, before, after });
    }
    return 1;
}

/** The description of the album or photo as the target holds it, '' for none, or null when it is not there. */
async function descriptionOf(source: string): Promise<string | null> {
    const parsed = parsePath(source);
    const isMedia = parsed?.kind === 'media';
    const albumPath = isMedia ? parsed.parentPath : source;
    const response = await fetch(`${run.to.site}/api/album${albumPath}?consistency=primary`, {
        headers: { cookie: run.to.cookie },
    });
    if (response.status === 404) {
        await response.body?.cancel();
        return null;
    }
    if (!response.ok) {
        throw new Error(`reading ${albumPath} failed: ${String(response.status)} ${await response.text()}`);
    }
    const album = valibot.parse(ALBUM, await response.json());
    if (!isMedia) {
        return album.description ?? '';
    }
    const child = album.children?.find((item) => item.itemName === parsed.name);
    return child === undefined ? null : (child.description ?? '');
}

function record(entry: Record<string, unknown>): void {
    appendFileSync(
        path.join(run.directory, `relink-${run.target}.jsonl`),
        `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
    );
}
