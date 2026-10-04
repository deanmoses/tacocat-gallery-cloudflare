// Gallery 2 showed an album in name order unless an admin dragged its photos into an order of their own. The 2014 move
// to Zenphoto carried the names and not the order, Zenphoto sorted by name, and so did AWS and this gallery after it,
// so those albums have shown their photos out of the order they were arranged in ever since. This traces each photo
// of such an album to the name it has today, through the Zenphoto photo the Gallery 2 comparison matched it to, and
// says what order the album goes back into. Nothing here touches the network, so a test can hold it still.
import { sanitizeMediaName } from '@tacocat-gallery/shared';
import { type Gallery2Item, treeOf } from './gallery2.ts';

/** A photo of Gallery 2's and the Zenphoto photo the comparison matched it to, both by path, `2008/01-13/tahoe01.jpg`. */
export interface Match {
    g2: string;
    zen: string;
}

/** An album Gallery 2 showed in an order of its admin's making, and the day album it is today. */
export interface HandOrdered {
    /** Its path in Gallery 2, such as `2009/11-01/party`. */
    from: string;
    /** The day album today, such as `/2009/10-30/`. */
    path: string;
    /** Today's name of each photo, in Gallery 2's order. */
    names: string[];
}

/** An album Gallery 2 ordered by hand whose order is not brought back, and why. */
export interface LeftAlone {
    from: string;
    reason: string;
}

/**
 * Albums an admin ordered by hand again in a later gallery, whose order stands over Gallery 2's: `/2010/01-24/`
 * was reordered in Zenphoto, and the 2023 move to AWS renamed its photos to keep that order.
 */
const ORDERED_SINCE = new Set(['/2010/01-24/']);

/**
 * Every album Gallery 2 ordered by hand that the gallery has today, and the ones it has no order to give back. A
 * photo the move matched is named for its Zenphoto file, and one it did not for its Gallery 2 file, since a photo the
 * move dropped was brought back under that name. An album none of whose photos came through Zenphoto was brought
 * back whole, with its order; one whose photos went to several albums has no one album to order.
 */
export function handOrdered(
    items: readonly Gallery2Item[],
    matches: readonly Match[],
): { albums: HandOrdered[]; leftAlone: LeftAlone[] } {
    const tree = treeOf(items);
    const zenOf = new Map(matches.map((match) => [match.g2, match.zen]));
    const albums: HandOrdered[] = [];
    const leftAlone: LeftAlone[] = [];
    for (const album of items.filter((item) => item.type === 'GalleryAlbumItem' && item.albumOrder === 'orderWeight')) {
        const from = tree.pathOf(album);
        const photos = items
            .filter((item) => item.parent === album.id && item.type === 'GalleryPhotoItem')
            .toSorted((first, second) => (first.order ?? 0) - (second.order ?? 0) || first.id - second.id);
        const zen = photos.map((photo) => zenOf.get(tree.pathOf(photo)));
        const zenAlbums = new Set(zen.flatMap((path) => (path === undefined ? [] : [dirOf(path)])));
        const [zenAlbum] = zenAlbums;
        if (photos.length < 2) {
            leftAlone.push({ from, reason: 'fewer than two photos' });
        } else if (zenAlbum === undefined) {
            leftAlone.push({ from, reason: 'none of its photos came through Zenphoto' });
        } else if (zenAlbums.size > 1) {
            leftAlone.push({ from, reason: `its photos went to ${[...zenAlbums].join(' and ')}` });
        } else if (ORDERED_SINCE.has(`/${zenAlbum}/`)) {
            leftAlone.push({ from, reason: 'ordered by hand again in a later gallery' });
        } else {
            albums.push({
                from,
                path: `/${zenAlbum}/`,
                names: photos.map((photo, index) => sanitizeMediaName(nameOf(zen[index] ?? photo.name ?? ''))),
            });
        }
    }
    return { albums, leftAlone };
}

/** What writing the album's order changes, against `shown`, the album's media names in the order it shows them. */
export interface OrderChange {
    /** The names to write, Gallery 2's order less the photos the album no longer has. */
    itemNames: string[];
    /** Gallery 2's photos the album does not have, culled since or never brought back, which the order leaves out. */
    missing: string[];
    /** The album's media that Gallery 2 did not have, which follow in name order. */
    added: string[];
    /**
     * Photos of Gallery 2's beside which the album holds a `_n` name, which the copy from AWS gave one of two items
     * that came out the same, so the plain name may be the other item's and neither can be trusted.
     */
    collided: string[];
    /** How many photos leave their place: the fewest moves that make today's order Gallery 2's. */
    moved: number;
    /** Whether the album is shown in some order other than its names' today, which the write replaces. */
    orderedToday: boolean;
}

export function orderChange(album: HandOrdered, shown: readonly string[]): OrderChange {
    const has = new Set(shown);
    const itemNames = album.names.filter((name) => has.has(name));
    const place = new Map(itemNames.map((name, index) => [name, index]));
    const today = shown.filter((name) => place.has(name)).map((name) => place.get(name) ?? 0);
    const byName = shown.toSorted(byCodeUnit);
    const missing = album.names.filter((name) => !has.has(name));
    const added = shown.filter((name) => !place.has(name));
    return {
        itemNames,
        missing,
        added,
        collided: album.names.filter((name) => added.some((other) => isNumbered(other, name))),
        moved: today.length - longestRise(today),
        orderedToday: shown.some((name, index) => name !== byName[index]),
    };
}

/** The length of the longest subsequence that rises, which is how many photos can stay where they are. */
function longestRise(places: readonly number[]): number {
    const tails: number[] = [];
    for (const place of places) {
        let low = 0;
        let high = tails.length;
        while (low < high) {
            const middle = (low + high) >> 1;
            if ((tails[middle] ?? 0) < place) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        tails[low] = place;
    }
    return tails.length;
}

/** Whether `other` is `name` with `_n` after it, as the copy from AWS told a second item of a name apart. */
function isNumbered(other: string, name: string): boolean {
    return other.startsWith(`${name}_`) && /^\d+$/v.test(other.slice(name.length + 1));
}

function dirOf(path: string): string {
    return path.slice(0, path.lastIndexOf('/'));
}

function nameOf(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
}

function byCodeUnit(first: string, second: string): number {
    return Number(first > second) - Number(first < second);
}
