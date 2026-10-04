// Descriptions link to albums, photos and files by the addresses of the galleries before this one, which no longer
// answer. Moses picked, link by link, what each becomes from a contact sheet of the link's description beside its
// candidate targets, and this applies a pick to a description. Nothing here touches the network, so a test can hold it
// still.
//
// A pick names the link by the address it holds, as the sheet read it out of the description's HTML: the value of an
// `<a href>` or an `<img src>`, its entities decoded. It points the link at a gallery path or another address, or takes
// it off: an `<a>` keeps its text, an `<img>` goes. Each link holding that address in the description changes, and
// nothing else does.
import { parsePath } from '@tacocat-gallery/shared';

export type Relink =
    | { id: string; source: string; from: string; kind: 'point'; to: string }
    | { id: string; source: string; from: string; kind: 'unlink' };

/** What a pick did to a description: changed it, found its link pointing where it says already, or found no link. */
export type RelinkOutcome = 'rewritten' | 'already' | 'absent';

/**
 * The picks the contact sheet copied out, one a line: `<id>  a  <gallery path>  <source>  <address>` to point the link
 * at a candidate, `<id>  abs  <address to>  <source>  <address>` to point it elsewhere, and `<id>  unlink  <source>
 * <address>` to take it off. A source is the gallery path of the album or photo whose description holds the link, an
 * album's without its trailing slash, as the sheet writes it; it comes back in the gallery's own form.
 */
export function parseRelinks(text: string): Relink[] {
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .map((line) => {
            const [id = '', kind, ...rest] = line.split(/\s+/v);
            if (kind === 'a' || kind === 'abs') {
                const [to, source, from] = rest;
                if (to === undefined || source === undefined || from === undefined || rest.length !== 3) {
                    throw new Error(`a pick to point a link takes a target, a source and an address: [${line}]`);
                }
                return { id, source: galleryPath(source), from, kind: 'point', to };
            }
            if (kind === 'unlink') {
                const [source, from] = rest;
                if (source === undefined || from === undefined || rest.length !== 2) {
                    throw new Error(`a pick to unlink takes a source and an address: [${line}]`);
                }
                return { id, source: galleryPath(source), from, kind: 'unlink' };
            }
            throw new Error(`a pick is a, abs or unlink: [${line}]`);
        });
}

/** The gallery path of an album or photo, an album's with the trailing slash the sheet leaves off. */
function galleryPath(source: string): string {
    for (const candidate of [source, `${source}/`]) {
        const kind = parsePath(candidate)?.kind;
        if (kind === 'year' || kind === 'day' || kind === 'media') {
            return candidate;
        }
    }
    throw new Error(`not an album or photo path: [${source}]`);
}

// An `<a>` with what it holds, or an `<img>`. Descriptions are the gallery's own HTML, with no `<a>` inside another.
const ELEMENT = /<a\b[^>]*>[\s\S]*?<\/a\s*>|<img\b[^>]*>/giv;
const OPENING = /^<[^>]*>/v;
const ADDRESS = /\b(?<attribute>href|src)\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\s"'>]+))/iv;
const CLOSING = /<\/a\s*>$/iv;

/** The description with the pick applied, and what applying it did. */
export function relinked(description: string, relink: Relink): { description: string; outcome: RelinkOutcome } {
    let rewritten = '';
    let after = 0;
    let found = false;
    let already = false;
    for (const match of description.matchAll(ELEMENT)) {
        const [element] = match;
        const opening = OPENING.exec(element)?.[0] ?? '';
        const address = ADDRESS.exec(opening);
        const groups = address?.groups ?? {};
        const value = decoded(groups['double'] ?? groups['single'] ?? groups['bare'] ?? '');
        already ||= relink.kind === 'point' && value === relink.to;
        if (address === null || value !== relink.from) {
            continue;
        }
        found = true;
        rewritten += description.slice(after, match.index) + replacement(element, opening, address, relink);
        after = match.index + element.length;
    }
    if (!found) {
        return { description, outcome: already ? 'already' : 'absent' };
    }
    return { description: rewritten + description.slice(after), outcome: 'rewritten' };
}

/** What the element becomes: its address pointed where the pick says, or the element taken off. */
function replacement(element: string, opening: string, address: RegExpExecArray, relink: Relink): string {
    if (relink.kind === 'unlink') {
        return element.toLowerCase().startsWith('<img') ? '' : element.slice(opening.length).replace(CLOSING, '');
    }
    const attribute = `${address.groups?.['attribute'] ?? 'href'}="${encoded(relink.to)}"`;
    return (
        opening.slice(0, address.index) +
        attribute +
        opening.slice(address.index + address[0].length) +
        element.slice(opening.length)
    );
}

const ENTITY = /&(?:#x[0-9a-f]+|#\d+|amp|apos|gt|lt|quot);/giv;
const NAMED: Record<string, string> = { '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' };

/** The value with its entities decoded, each once, so `&amp;lt;` is `&lt;`. */
function decoded(value: string): string {
    return value.replaceAll(ENTITY, (entity) => {
        const named = NAMED[entity.toLowerCase()];
        if (named !== undefined) {
            return named;
        }
        const hex = entity[2]?.toLowerCase() === 'x';
        return String.fromCodePoint(Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10));
    });
}

function encoded(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}
