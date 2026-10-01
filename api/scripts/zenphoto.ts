// What the recovery of Zenphoto's unpublished content makes of its database. The 2023 move to AWS wrote a row for
// each published album and photo and none for an unpublished one, so those are what is left to bring over: each day
// album Zenphoto never showed, and each photo it hid inside an album it did show. Their words are translated as the
// 2023 move translated the published ones, so a recovered caption reads like its neighbours: a value Zenphoto stored
// as a PHP-serialized array of locales is unpacked to its `en_US` text, `&apos;` and `&nbsp;` become the characters,
// and a link Zenphoto wrote as `#2008/01-10` becomes `/2008/01-10`. Names, and the order an album is shown in, follow
// the copy from AWS, since a recovered album has to look as it would have had the move taken it. Nothing here
// touches the network, so a test can hold it still.
import { deduplicateNames, mediaPath, parsePath } from '@tacocat-gallery/shared';
import { type Rectangle, copiedCrop } from './aws-crops.ts';
import { type Renamed, awsOrder, renamedMedia, rewriteLinks, sanitizedPath } from './aws-names.ts';
import type { RecoveredAlbum } from './recovered-album.ts';

/** An album row of Zenphoto's, as far as the recovery reads it. `folder` is its path without the outer slashes. */
export interface ZenphotoAlbum {
    id: number;
    folder: string;
    show: number;
    desc: string | null;
    custom_data: string | null;
    thumb: string | null;
}

/** An image row of Zenphoto's. Its crop is in pixels of the image, each part null where an admin never cut one. */
export interface ZenphotoImage {
    albumid: number;
    filename: string;
    show: number;
    title: string | null;
    desc: string | null;
    width: number;
    height: number;
    thumbX: number | null;
    thumbY: number | null;
    thumbW: number | null;
    thumbH: number | null;
    filesize: number | null;
    tags: string[] | null;
}

// Zenphoto's own test albums, which hold nothing of the gallery's.
const TEST_ALBUMS = /^(?:1993\/08-15\/test1|2022\/11-01\/not_for_tacocat)(?:\/|$)/v;

/**
 * Every album with something to recover, in path order: the unpublished day albums with all their photos, and the
 * published ones that hold an unpublished photo, with those photos alone.
 */
export function recoveryPlan(albums: readonly ZenphotoAlbum[], images: readonly ZenphotoImage[]): RecoveredAlbum[] {
    const byAlbum = Map.groupBy(images, (image) => image.albumid);
    return albums
        .filter((album) => !TEST_ALBUMS.test(album.folder) && parsePath(`/${album.folder}/`)?.kind === 'day')
        .map((album) => recoveredAlbum(album, byAlbum.get(album.id) ?? []))
        .filter((album) => album.draft || album.media.length > 0)
        .toSorted((first, second) => Number(first.path > second.path) - Number(first.path < second.path));
}

function recoveredAlbum(album: ZenphotoAlbum, images: readonly ZenphotoImage[]): RecoveredAlbum {
    const path = `/${album.folder}/`;
    const draft = album.show === 0;
    const renamed = renamedNames(images, draft);
    const names = new Map(renamed.map(({ from, to }) => [from, to]));
    const pathOf = (filename: string): string | null => {
        const name = names.get(filename);
        return name === undefined ? null : mediaPath(path, name);
    };
    const html = (text: string | null): string | null => captionHtml(text, path, pathOf);
    const media = images
        .filter((image) => draft || image.show === 0)
        .map((image) => {
            const name = names.get(image.filename) ?? '';
            const size = { width: image.width, height: image.height };
            return {
                file: `${album.folder}/${image.filename}`,
                path: mediaPath(path, name),
                name,
                title: plainText(image.title),
                description: html(image.desc),
                crop: cropOf(image, size),
                size,
                bytes: image.filesize,
                tags: image.tags ?? [],
            };
        })
        .toSorted((first, second) => Number(first.name > second.name) - Number(first.name < second.name));
    if (!draft) {
        return { path, draft, summary: null, description: null, thumbnail: null, order: null, media };
    }
    const order = awsOrder(renamed);
    // Zenphoto names the album's thumbnail by its file, or holds `1` or nothing for whichever photo comes first.
    const first = order?.[0] ?? media[0]?.name;
    return {
        path,
        draft,
        summary: plainText(album.custom_data),
        description: html(album.desc),
        thumbnail: pathOf(album.thumb ?? '') ?? (first === undefined ? null : mediaPath(path, first)),
        order,
        media,
    };
}

/**
 * Each photo's name here, by its file name. An unpublished album is named as the copy would have named it. In a
 * published one the photos the move took have their names already, so they are named first and a hidden photo steps
 * past them.
 */
function renamedNames(images: readonly ZenphotoImage[], draft: boolean): Renamed[] {
    const named = (group: readonly ZenphotoImage[]): Renamed[] =>
        renamedMedia(group.map((image) => ({ itemName: image.filename })));
    if (draft) {
        return named(images);
    }
    const taken = named(images.filter((image) => image.show !== 0));
    const hidden = named(images.filter((image) => image.show === 0));
    const free = deduplicateNames([...taken, ...hidden].map(({ to }) => to)).slice(taken.length);
    return [...taken, ...hidden.map((item, index) => ({ ...item, to: free[index] ?? '' }))];
}

function cropOf(image: ZenphotoImage, size: { width: number; height: number }): Rectangle | null {
    const { thumbX, thumbY, thumbW, thumbH } = image;
    return thumbX === null || thumbY === null || thumbW === null || thumbH === null
        ? null
        : copiedCrop({ x: thumbX, y: thumbY, width: thumbW, height: thumbH }, size);
}

/**
 * The `en_US` text of a value Zenphoto stored as a PHP-serialized array of locales, `a:1:{s:5:"en_US";s:5:"07-04";}`,
 * or the first locale with any text when it has no `en_US`; a value stored plain comes back as it is. PHP counts a
 * string's length in bytes, so the value is read as UTF-8 bytes.
 */
export function unserialized(value: string): string {
    if (!/^a:\d+:\{/v.test(value)) {
        return value;
    }
    const bytes = Buffer.from(value, 'utf8');
    let at = 0;
    const skip = (expected: string): void => {
        if (bytes.toString('utf8', at, at + expected.length) !== expected) {
            throw new Error(`Not a PHP-serialized array of strings, at byte ${String(at)}: ${value.slice(0, 80)}`);
        }
        at += expected.length;
    };
    const until = (mark: string): string => {
        const end = bytes.indexOf(mark, at);
        if (end === -1) {
            throw new Error(`Not a PHP-serialized array of strings, no ${mark} after byte ${String(at)}`);
        }
        const text = bytes.toString('utf8', at, end);
        at = end + mark.length;
        return text;
    };
    const string = (): string => {
        skip('s:');
        const length = Number(until(':'));
        skip('"');
        const text = bytes.toString('utf8', at, at + length);
        at += length;
        skip('";');
        return text;
    };
    skip('a:');
    const count = Number(until(':'));
    skip('{');
    const byLocale = new Map<string, string>();
    for (let entry = 0; entry < count; entry += 1) {
        byLocale.set(string(), string());
    }
    return byLocale.get('en_US') ?? byLocale.values().find((text) => text !== '') ?? '';
}

const ENTITIES = new Map([
    ['amp', '&'],
    ['apos', "'"],
    ['quot', '"'],
    ['lt', '<'],
    ['gt', '>'],
    ['nbsp', ' '],
]);

/**
 * A title or a summary, which the gallery shows as text: unpacked, with the entities Zenphoto escaped it with turned
 * back into their characters, or null when nothing is left.
 */
export function plainText(value: string | null): string | null {
    const text = unserialized(value ?? '')
        .replaceAll(/&(?<name>[a-z]+);/gv, (entity, name: string) => ENTITIES.get(name) ?? entity)
        .trim();
    return text === '' ? null : text;
}

/**
 * A description, which the gallery shows as HTML, so its other entities stay: unpacked, with Zenphoto's `#` links
 * made paths, and every link to a media item pointed at the name the item has here. A link into `album`, the
 * description's own, is resolved by `pathOf` from the item's file name; one into another album by the sanitizer.
 */
export function captionHtml(
    value: string | null,
    album: string,
    pathOf: (filename: string) => string | null,
): string | null {
    const text = unserialized(value ?? '')
        .replaceAll('&apos;', "'")
        .replaceAll('&nbsp;', ' ')
        .replaceAll('href="#', 'href="/')
        .trim();
    const { html } = rewriteLinks(text, (linked) => {
        const cut = linked.lastIndexOf('/');
        return linked.slice(0, cut + 1) === album ? pathOf(linked.slice(cut + 1)) : sanitizedPath(linked);
    });
    return html === '' ? null : html;
}
