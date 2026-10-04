// What the recovery of what Gallery 2 lost makes of its database. The 2014 move to Zenphoto made each of Gallery 2's
// sub-albums, such as `2008/01-21/tatou`, a day album of its own, and dropped a few albums, photos and words on the
// way. Each album named here comes back as the day album the move would have made it, each photo into the album the
// gallery has, and each summary and caption onto the row that lacks it. Gallery 2 stored its text entity-escaped,
// tags and all, and showed a sub-album in the order of its items' weights, so the text is unescaped and that order
// kept. Nothing here touches the network, so a test can hold it still.
import { mediaPath } from '@tacocat-gallery/shared';
import { renamedMedia } from './aws-names.ts';
import type { RecoveredAlbum, RecoveredMedia } from './recovered-album.ts';

/** An item row of Gallery 2's, album or photo, as far as the recovery reads it. The root album has no name. */
export interface Gallery2Item {
    id: number;
    parent: number;
    type: string;
    name: string | null;
    title: string | null;
    summary: string | null;
    desc: string | null;
    order: number | null;
    /** How the album sorts its items: `orderWeight` is by hand, in the order of their weights. */
    albumOrder: string | null;
    width: number | null;
    height: number | null;
}

/** An album of Gallery 2's that the gallery lacks, and the day album it comes back as. */
export interface LostAlbum {
    /** Its path in Gallery 2, such as `2008/01-21/tatou`. */
    from: string;
    to: string;
    /** The file to upload for a photo, by its Gallery 2 name, where the original in the day's folder has another. */
    files: Record<string, string>;
}

// A sub-album comes after the album that holds it, whose description links to it once both are there.
export const LOST_ALBUMS: LostAlbum[] = [
    {
        from: '2008/01-21/tatou',
        to: '/2008/01-22/',
        files: { 'bikes.jpg': '1bikes.jpg', 'croissants.jpg': '3croissants.jpg', 'breakfast.jpg': '4breakfast.jpg' },
    },
    { from: '2008/02-03', to: '/2008/02-03/', files: {} },
    { from: '2008/02-03/pk', to: '/2008/02-02/', files: {} },
    { from: '2008/04-13', to: '/2008/04-13/', files: {} },
    { from: '2012/06-22', to: '/2012/06-22/', files: {} },
];

/** Photos the move dropped from day albums the gallery has, by their paths in Gallery 2. */
export const LOST_PHOTOS = ['2011/05-08/zzzmothersday.jpg'];

/**
 * Day albums whose summary, and photos whose title and caption, only Gallery 2 has, by their paths in Gallery 2. A
 * summary that named a day album's sub-album, such as `2008/07-06`'s "Dean in Malaysia", stays behind: the move made
 * the sub-album a day album of its own, which has it.
 */
export const LOST_WORDS = {
    summaries: [
        '2010/01-17',
        '2010/01-24',
        '2010/03-07',
        '2010/03-14',
        '2010/03-21',
        '2010/03-28',
        '2010/05-23',
        '2010/06-13',
        '2010/07-11',
        '2010/08-08',
        '2014/12-10',
    ],
    captions: ['2009/04-19/jedi05.jpg', '2012/02-26/kauai23.jpg'],
};

/** A link in another album's description that pointed at the lost album where Gallery 2 had it. */
export interface MovedLink {
    album: string;
    from: string;
    to: string;
}

/**
 * The lost album as the recovery writes it, unpublished, and for a sub-album the link its parent's description holds
 * to it, `href="tatou/"`, with the path that replaces it. A sub-album's title is its summary, as the 2014 move made
 * it, and a day album keeps its summary. An album Gallery 2 ordered by hand keeps that order, and any other is in
 * name order, as the gallery shows a day album. The album is shown by its first photo.
 */
export function recoveredAlbum(
    items: readonly Gallery2Item[],
    lost: LostAlbum,
): { album: RecoveredAlbum; link: MovedLink | null } {
    const tree = treeOf(items);
    const source = items.find((item) => item.type === 'GalleryAlbumItem' && tree.pathOf(item) === lost.from);
    if (source === undefined) {
        throw new Error(`Gallery 2 has no album ${lost.from}`);
    }
    const parent = tree.byId.get(source.parent);
    const parentPath = parent === undefined ? '' : `/${tree.pathOf(parent)}`;
    const subAlbum = /^\/\d{4}\/\d{2}-\d{2}$/v.test(parentPath);
    const byHand = source.albumOrder === 'orderWeight';
    const photos = items.filter((item) => item.parent === source.id && item.type === 'GalleryPhotoItem');
    const renamed = renamedMedia(photos.map((photo) => ({ itemName: photo.name ?? '' })));
    const media = photos
        .map((photo, index) => {
            const file = photo.name ?? '';
            return {
                weight: photo.order ?? 0,
                item: {
                    ...recoveredMedia(photo, lost.to, renamed[index]?.to ?? '', tree.pathOf(photo)),
                    file: `${lost.to.slice(1)}${lost.files[file] ?? file}`,
                },
            };
        })
        .toSorted((first, second) =>
            byHand ? first.weight - second.weight : byCodeUnit(first.item.name, second.item.name),
        )
        .map(({ item }) => item);
    const description = captionHtml(source.desc)?.split('href="../"').join(`href="${parentPath}"`) ?? null;
    const [first] = media;
    return {
        album: {
            path: lost.to,
            draft: true,
            summary: plainText(subAlbum ? source.title : source.summary),
            description,
            thumbnail: first?.path ?? null,
            order: byHand ? media.map((item) => item.name) : null,
            media,
        },
        link:
            source.name === null || !subAlbum
                ? null
                : { album: `${parentPath}/`, from: `href="${source.name}/"`, to: `href="${lost.to.slice(0, -1)}"` },
    };
}

/**
 * The lost photos as additions to the published day albums the gallery has, one entry for each album, which keeps
 * its words, thumbnail and order: a photo it gains goes after the others when an admin has ordered the album.
 */
export function recoveredPhotos(items: readonly Gallery2Item[], paths: readonly string[]): RecoveredAlbum[] {
    const tree = treeOf(items);
    const albums = new Map<string, RecoveredAlbum>();
    for (const from of paths) {
        const photo = items.find((item) => item.type === 'GalleryPhotoItem' && tree.pathOf(item) === from);
        if (photo === undefined) {
            throw new Error(`Gallery 2 has no photo ${from}`);
        }
        const day = dayOf(from);
        const [renamed] = renamedMedia([{ itemName: photo.name ?? '' }]);
        const album = albums.get(day) ?? {
            path: day,
            draft: false,
            summary: null,
            description: null,
            thumbnail: null,
            order: null,
            media: [],
        };
        album.media.push(recoveredMedia(photo, day, renamed?.to ?? '', from));
        albums.set(day, album);
    }
    return [...albums.values()];
}

/** A summary, title or caption only Gallery 2 has, and the gallery path of the album or photo it goes onto. */
export interface LostWords {
    path: string;
    field: 'summary' | 'title' | 'description';
    text: string;
}

/** The words `lost` names, as the gallery writes them: a summary and a title as text, a caption as HTML. */
export function lostWords(
    items: readonly Gallery2Item[],
    lost: { summaries: readonly string[]; captions: readonly string[] },
): LostWords[] {
    const tree = treeOf(items);
    const find = (type: string, from: string): Gallery2Item => {
        const found = items.find((item) => item.type === type && tree.pathOf(item) === from);
        if (found === undefined) {
            throw new Error(`Gallery 2 has no ${from}`);
        }
        return found;
    };
    const words = [
        ...lost.summaries.map((from) => ({
            path: `/${from}/`,
            field: 'summary' as const,
            text: plainText(find('GalleryAlbumItem', from).summary),
        })),
        ...lost.captions.flatMap((from) => {
            const photo = find('GalleryPhotoItem', from);
            const [renamed] = renamedMedia([{ itemName: photo.name ?? '' }]);
            const path = mediaPath(dayOf(from), renamed?.to ?? '');
            return [
                { path, field: 'title' as const, text: plainText(photo.title) },
                { path, field: 'description' as const, text: captionHtml(photo.desc) },
            ];
        }),
    ];
    return words.map(({ path, field, text }) => {
        if (text === null) {
            throw new Error(`Gallery 2 has no ${field} for ${path}`);
        }
        return { path, field, text };
    });
}

/** One of Gallery 2's photos as the recovery writes it into `albumPath` under `name`, with Gallery 2's own copy. */
function recoveredMedia(photo: Gallery2Item, albumPath: string, name: string, copy: string): RecoveredMedia {
    return {
        file: `${albumPath.slice(1)}${photo.name ?? ''}`,
        path: mediaPath(albumPath, name),
        name,
        title: plainText(photo.title),
        description: captionHtml(photo.desc),
        crop: null,
        size: { width: photo.width ?? 0, height: photo.height ?? 0 },
        bytes: null,
        tags: [],
        copy,
    };
}

/** Gallery 2's items by id, and the path of each, which its own and its parents' names make. */
function treeOf(items: readonly Gallery2Item[]): {
    byId: Map<number, Gallery2Item>;
    pathOf: (item: Gallery2Item) => string;
} {
    const byId = new Map(items.map((item) => [item.id, item]));
    const pathOf = (item: Gallery2Item): string => {
        const names: string[] = [];
        for (let at: Gallery2Item | undefined = item; at !== undefined && at.name !== null; at = byId.get(at.parent)) {
            names.unshift(at.name);
        }
        return names.join('/');
    };
    return { byId, pathOf };
}

/** The gallery path of the day album that a Gallery 2 path in a day album lies in. */
function dayOf(from: string): string {
    return `/${from.split('/').slice(0, 2).join('/')}/`;
}

function byCodeUnit(first: string, second: string): number {
    return Number(first > second) - Number(first < second);
}

const ESCAPES = new Map([
    ['amp', '&'],
    ['lt', '<'],
    ['gt', '>'],
    ['quot', '"'],
    ['#039', "'"],
]);

/** Text with one layer of Gallery 2's escaping taken off. */
function unescaped(text: string): string {
    return text.replaceAll(/&(?<name>#039|amp|gt|lt|quot);/gv, (entity, name: string) => ESCAPES.get(name) ?? entity);
}

/** A title, which the gallery shows as text: unescaped until nothing changes, since Gallery 2 escaped some twice. */
export function plainText(value: string | null): string | null {
    const text = whollyUnescaped(value ?? '')
        .replaceAll(/\s+/gv, ' ')
        .trim();
    return text === '' ? null : text;
}

function whollyUnescaped(text: string): string {
    const once = unescaped(text);
    return once === text ? text : whollyUnescaped(once);
}

/**
 * A description, which the gallery shows as HTML: unescaped until its tags are tags, and no further, so an entity
 * the HTML itself needs stays. Gallery 2's line breaks, which a browser shows as spaces, become spaces.
 */
export function captionHtml(value: string | null): string | null {
    let text = unescaped(value ?? '');
    while (/&lt;|&amp;(?:amp|gt|lt|quot);/v.test(text)) {
        text = unescaped(text);
    }
    text = text.replaceAll(/\s+/gv, ' ').trim();
    return text === '' ? null : text;
}
