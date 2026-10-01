// What the recovery of Gallery 2's lost albums makes of its database. The 2014 move to Zenphoto made each of Gallery
// 2's sub-albums, such as `2008/01-21/tatou`, a day album of its own, and dropped a few albums on the way; each one
// named here comes back as the day album the move would have made it. Gallery 2 stored its text entity-escaped, tags
// and all, and showed an album in the order of its items' weights, so the text is unescaped and the order kept.
// Nothing here touches the network, so a test can hold it still.
import { mediaPath } from '@tacocat-gallery/shared';
import { renamedMedia } from './aws-names.ts';
import type { RecoveredAlbum } from './recovered-album.ts';

/** An item row of Gallery 2's, album or photo, as far as the recovery reads it. The root album has no name. */
export interface Gallery2Item {
    id: number;
    parent: number;
    type: string;
    name: string | null;
    title: string | null;
    desc: string | null;
    order: number | null;
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

export const LOST_ALBUMS: LostAlbum[] = [
    {
        from: '2008/01-21/tatou',
        to: '/2008/01-22/',
        files: { 'bikes.jpg': '1bikes.jpg', 'croissants.jpg': '3croissants.jpg', 'breakfast.jpg': '4breakfast.jpg' },
    },
];

/** A link in another album's description that pointed at the lost album where Gallery 2 had it. */
export interface MovedLink {
    album: string;
    from: string;
    to: string;
}

/**
 * The lost album as the recovery writes it, unpublished, and for a sub-album the link its parent's description holds
 * to it, `href="tatou/"`, with the path that replaces it. Gallery 2's album title is the summary, as the 2014 move
 * made it, and the album is shown by its first photo.
 */
export function recoveredAlbum(
    items: readonly Gallery2Item[],
    lost: LostAlbum,
): { album: RecoveredAlbum; link: MovedLink | null } {
    const byId = new Map(items.map((item) => [item.id, item]));
    const pathOf = (item: Gallery2Item): string => {
        const names: string[] = [];
        for (let at: Gallery2Item | undefined = item; at !== undefined && at.name !== null; at = byId.get(at.parent)) {
            names.unshift(at.name);
        }
        return names.join('/');
    };
    const source = items.find((item) => item.type === 'GalleryAlbumItem' && pathOf(item) === lost.from);
    if (source === undefined) {
        throw new Error(`Gallery 2 has no album ${lost.from}`);
    }
    const parent = byId.get(source.parent);
    const parentPath = parent === undefined ? '' : `/${pathOf(parent)}`;
    const photos = items
        .filter((item) => item.parent === source.id && item.type === 'GalleryPhotoItem')
        .toSorted((first, second) => (first.order ?? 0) - (second.order ?? 0));
    const renamed = renamedMedia(photos.map((photo) => ({ itemName: photo.name ?? '' })));
    const media = photos.map((photo, index) => {
        const name = renamed[index]?.to ?? '';
        const file = photo.name ?? '';
        return {
            file: `${lost.to.slice(1)}${lost.files[file] ?? file}`,
            path: mediaPath(lost.to, name),
            name,
            title: plainText(photo.title),
            description: captionHtml(photo.desc),
            crop: null,
            size: { width: photo.width ?? 0, height: photo.height ?? 0 },
            bytes: null,
            tags: [],
        };
    });
    const description = captionHtml(source.desc)?.split('href="../"').join(`href="${parentPath}"`) ?? null;
    const [first] = media;
    return {
        album: {
            path: lost.to,
            draft: true,
            summary: plainText(source.title),
            description,
            thumbnail: first?.path ?? null,
            order: media.map((item) => item.name),
            media,
        },
        link:
            source.name === null || !/^\/\d{4}\/\d{2}-\d{2}$/v.test(parentPath)
                ? null
                : { album: `${parentPath}/`, from: `href="${source.name}/"`, to: `href="${lost.to.slice(0, -1)}"` },
    };
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
