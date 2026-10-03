// What the copy from AWS does to names and links. AWS media names carry their extensions and were never sanitized,
// so each becomes the name the sanitizer makes of it, and two that come out the same in one day album are told apart
// by `_n`. A link in a description that names an AWS media path is rewritten to the item's new path. A day album AWS
// holds under a date the calendar lacks moves to a real one, and an album keeps the order AWS showed it in. Nothing
// here touches the network, so both scripts share it and a test can hold it still.
import { deduplicateNames, mediaKey, mediaPath, parsePath, sanitizeMediaName } from '@tacocat-gallery/shared';

/** A media item as AWS lists it: its name there, and `video` for a video, which AWS says in `mediaType`. */
export interface AwsNamed {
    itemName: string;
    mediaType?: string | undefined;
}

/** One item's name on AWS and here, and whether a `_n` was needed to keep it apart from another. */
export interface Renamed {
    from: string;
    to: string;
    collided: boolean;
}

/**
 * The new name of every media item in one AWS day album, by its AWS name. Where two come out the same, the photos come
 * before the videos, so a Live Photo's still keeps the name and its clip gets `_2`, and among those of one kind the AWS
 * names' own order decides, by UTF-16 code unit. Nothing in it changes between runs: AWS kept no creation date, and the
 * date it did keep moves with every edit, and a mapping that moved between the copy of one album and the links written
 * into another would point those links at the wrong item.
 */
export function renamedMedia(items: readonly AwsNamed[]): Renamed[] {
    const rank = (item: AwsNamed): string => `${item.mediaType === 'video' ? 1 : 0}${item.itemName}`;
    const ordered = items.toSorted((first, second) =>
        rank(first) < rank(second) ? -1 : Number(rank(first) > rank(second)),
    );
    const sanitized = ordered.map((item) => sanitizeMediaName(item.itemName));
    const names = deduplicateNames(sanitized);
    const renamed = new Map(
        ordered.map((item, index) => [
            item.itemName,
            { from: item.itemName, to: names[index] ?? '', collided: names[index] !== sanitized[index] },
        ]),
    );
    return items.map((item) => renamed.get(item.itemName) ?? { from: item.itemName, to: '', collided: false });
}

/**
 * The album's new names in the order AWS showed them, or null where the new names already sort that way. AWS showed an
 * album in DynamoDB's order of its names, by UTF-8 byte, which JavaScript's comparison by UTF-16 code unit matches for
 * every name in the gallery, since all of them are ASCII. Sanitizing reorders some: a hyphen sorted before the
 * extension's dot, and a capital before any lowercase letter, and a caption that tells a story needs its photos where
 * they were.
 */
export function awsOrder(renamed: readonly Renamed[]): string[] | null {
    const byCodeUnit = (first: string, second: string): number => Number(first > second) - Number(first < second);
    const shown = renamed.toSorted((first, second) => byCodeUnit(first.from, second.from)).map(({ to }) => to);
    const byName = shown.toSorted(byCodeUnit);
    return shown.every((name, index) => name === byName[index]) ? null : shown;
}

// AWS never checked a day album's name against the calendar, and could not rename an album that held photos, so this
// one kept its November 31st. It goes to the last real day of its month, which an admin corrects after the copy.
const MOVED_DAYS = new Map([['/1991/11-31/', '/1991/11-30/']]);

/** The path an AWS album is copied to: its own, unless the calendar has no such day. */
export function copiedAlbumPath(awsPath: string): string {
    return MOVED_DAYS.get(awsPath) ?? awsPath;
}

/** A link in a description as the copy rewrote it, or could not: `to` is null for a media path it could not resolve. */
export interface RewrittenLink {
    from: string;
    to: string | null;
}

const HREF = /href="(?<href>[^"]*)"/gv;
const GALLERY_ORIGIN = /^https?:\/\/[^\/]*tacocat\.com/v;

/**
 * `html`, a description or summary, with every link to an AWS media path pointed at the item's new path, which
 * `resolve` answers by the AWS path, percent-decoded, or null for one it does not know. A link to an album, to a
 * media path that is already a new one, or to anything outside the gallery is left as it is and not reported. The
 * gallery's own origin in a link is dropped, since the site serves the app and the API alike.
 */
export function rewriteLinks(
    html: string,
    resolve: (awsPath: string) => string | null,
): { html: string; links: RewrittenLink[] } {
    const links: RewrittenLink[] = [];
    const rewritten = html.replaceAll(HREF, (match, href: string) => {
        const path = decoded(href.replace(GALLERY_ORIGIN, ''));
        if (!isAwsMediaPath(path)) {
            return match;
        }
        const to = resolve(path);
        links.push({ from: href, to });
        return to === null ? match : `href="${to}"`;
    });
    return { html: rewritten, links };
}

/** `text` percent-decoded, or as it came when it is not valid percent-encoding, which then names nothing. */
function decoded(text: string): string {
    try {
        return decodeURIComponent(text);
    } catch {
        return text;
    }
}

/** Whether `path` names a media item as AWS's URLs did: in a day album, under a name this gallery would refuse. */
export function isAwsMediaPath(path: string): boolean {
    const cut = path.lastIndexOf('/');
    const album = copiedAlbumPath(path.slice(0, cut + 1));
    const name = path.slice(cut + 1);
    return parsePath(album)?.kind === 'day' && name !== '' && mediaKey(path) === null;
}

/**
 * The new path of an AWS media path, by the sanitizer alone: right unless the item collided with another in its album.
 */
export function sanitizedPath(awsPath: string): string | null {
    const cut = awsPath.lastIndexOf('/');
    const name = sanitizeMediaName(awsPath.slice(cut + 1));
    return name === '' ? null : mediaPath(copiedAlbumPath(awsPath.slice(0, cut + 1)), name);
}
