// What the recovery of what the static gallery of 2001 to 2006 lost makes of its pages. Its photos came into Gallery 2
// in 2007 but for these, which Moses chose from a contact sheet of each beside the gallery photos it could be: an
// album no later gallery had, the five photos of a page whose sub-page did come across, an album nothing linked to,
// two photos on pages of their own and the first photo of an album page. Dropbox has none of them, so each is the
// static gallery's own copy, under `files/` by its path in `pix/`. Each photo's caption is its static page's, and its
// title is made from its name as Gallery 2 made the titles of the photos that did come across, `party01` as "Party 1".
// Nothing here touches the network, so a test can hold it still.
import { mediaPath, sanitizeMediaName } from '@tacocat-gallery/shared';
import * as valibot from 'valibot';
import type { RecoveredAlbum, RecoveredMedia } from './recovered-album.ts';

/** A row of the static gallery's inventory, `items.jsonl`, as far as the recovery reads it. */
export const STATIC_ITEM = valibot.object({
    kind: valibot.string(),
    file: valibot.optional(valibot.string()),
    caption: valibot.optional(valibot.string()),
    width: valibot.optional(valibot.number()),
    height: valibot.optional(valibot.number()),
});

export type StaticItem = valibot.InferOutput<typeof STATIC_ITEM>;

/** One photo to bring back: its path in `pix/`, and what it gets other than what its name and page would give it. */
interface StaticPhoto {
    file: string;
    name?: string;
    title?: string;
    caption?: string;
}

/** A day album's share of the recovery: a new unpublished album, or photos added to an album the gallery has. */
export interface StaticAlbum {
    to: string;
    draft: boolean;
    summary: string | null;
    description: string | null;
    photos: StaticPhoto[];
}

const inFolder = (folder: string, names: readonly string[]): StaticPhoto[] =>
    names.map((name) => ({ file: `${folder}/${name}.jpg` }));

export const STATIC_ALBUMS: StaticAlbum[] = [
    {
        // "Week 16", which the static gallery's 2002 page linked to, between what are now /2002/03-25 and /2002/04-15.
        to: '/2002/04-02/',
        draft: true,
        summary: 'Week 16',
        description:
            '<p>March 26 - April 1, 2002</p><p>Big progress of the week: grabbing objects and navigating them to his mouth.</p>',
        photos: inFolder('2002/04/02/images', [
            'bruno1',
            'bruno2',
            'evan',
            'ezekiel1',
            'ezekiel2',
            'ezekiel3',
            'felix-jasper',
            'hands1',
            'hands2',
            'hands3',
            'hands4',
            'scrabble',
            'smile1',
            'smile2',
            'smile3',
            'tub1',
            'tub2',
            'wrestler1',
            'wrestler2',
            'wrestler3',
        ]),
    },
    {
        // The page's sub-page of Dean's new office is /2006/06-01, with the sub-page's words; these are the page's own.
        to: '/2006/06-04/',
        draft: true,
        summary: 'Catamaran; Life in a Pond',
        description:
            "<p>What with the recent camping in Mendocino and beaching in Hawaii, we're suffering from photographic exhaustion. It's slim pickings this week.</p><p>Milo definitely knows some colors: blue and green, for sure.</p><p>Milo has been asking Dean to count stuff all week: fingers, balls, french fries. One day he came out with a 'one two three' on his own. A day later he did 'un deux trois' with Lucie -- and she hadn't really been counting much with him. He seems to get the French and English terms for something at almost the same time, regardless of how much he's heard one or the other.</p><p>You can <a href=\"/2006/06-01\">read more about Dean's company</a>.</p>",
        photos: inFolder('2006/06/04/slides', ['catamaran1', 'catamaran2', 'science1', 'science2', 'science3']),
    },
    {
        // Titled "October 22, 2006", the day of what is now /2006/10-22, the Pumpkin Patch; no page linked to it.
        to: '/2006/10-21/',
        draft: true,
        summary: 'New School Classmates',
        description: null,
        photos: [
            ...inFolder('2006/newschool/slides', [
                'akira',
                'bena',
                'daniele',
                'daniele2',
                'darshan',
                'emmett',
                'felix',
                'francis',
                'hako',
            ]),
            { file: '2006/newschool/slides/oilivia.jpg', name: 'olivia' },
            ...inFolder('2006/newschool/slides', ['priya', 'sofia', 'torin', 'yohana', 'zara1', 'zara2']),
        ],
    },
    {
        // A page of its own, "Baby Bastille", which no other page linked to. Moses writes its caption once it is in.
        to: '/2003/12-11/',
        draft: true,
        summary: 'Ultrasound',
        description: null,
        photos: [
            {
                file: '2003/12/ultrasound_bastille/ultrasound_bastille_8w5d.jpg',
                name: 'milo_ultrasound_8w5d',
                title: 'Ultrasound',
                caption: 'Ultrasound - December 11, 2003. Baby Bastille - 8 weeks and 5 days.',
            },
        ],
    },
    {
        // The first photo of the static block party page, whose caption introduces the party.
        to: '/2005/10-23/',
        draft: false,
        summary: null,
        description: null,
        photos: [{ file: '2005/10/23/slides/block_00.jpg', title: 'Block Party Flyer' }],
    },
    {
        // A page of its own in the folder of Milo's birth, which no other page linked to; its words are its caption.
        to: '/2004/07-24/',
        draft: false,
        summary: null,
        description: null,
        photos: [
            {
                file: '2004/07/24/father-son/father-son.jpg',
                name: 'pop_and_son',
                title: 'Pop and Son',
                caption: "Milo looks a lot like Dean did as a baby. Dean's the middle one.",
            },
        ],
    },
];

/**
 * The album as the recovery writes it: its photos in name order, as the gallery shows an album no admin has ordered,
 * and a new album shown by its first. A photo the inventory does not list as a photo stops it.
 */
export function recoveredStaticAlbum(items: readonly StaticItem[], album: StaticAlbum): RecoveredAlbum {
    const byFile = new Map(items.filter((item) => item.kind === 'photo').map((item) => [item.file, item]));
    const media = album.photos
        .map((photo): RecoveredMedia => {
            const item = byFile.get(photo.file);
            if (item === undefined) {
                throw new Error(`The static gallery has no photo ${photo.file}`);
            }
            const base = photo.file.slice(photo.file.lastIndexOf('/') + 1);
            const name = photo.name ?? sanitizeMediaName(base);
            const caption = photo.caption ?? captionOf(item.caption);
            return {
                file: `${album.to.slice(1)}${base}`,
                path: mediaPath(album.to, name),
                name,
                title: photo.title ?? titleOf(name),
                description: caption,
                crop: null,
                size: { width: item.width ?? 0, height: item.height ?? 0 },
                bytes: null,
                tags: [],
                copy: photo.file,
            };
        })
        .toSorted((first, second) => Number(first.name > second.name) - Number(first.name < second.name));
    const names = new Set(media.map((item) => item.name));
    if (names.size !== media.length) {
        throw new Error(`Two photos of ${album.to} have one name`);
    }
    return {
        path: album.to,
        draft: album.draft,
        summary: album.summary,
        description: album.description,
        thumbnail: album.draft ? (media[0]?.path ?? null) : null,
        order: null,
        media,
    };
}

/**
 * The title Gallery 2 gave a photo it took from the static gallery, by its name: each word capitalized, and a number
 * at the end its own word without its leading zeros, so `party01` is "Party 1" and `felix_jasper` "Felix Jasper". A
 * name of digits alone stays as it is, as `01` did.
 */
export function titleOf(name: string): string {
    if (/^\d+$/v.test(name)) {
        return name;
    }
    const { stem = name, number } = /^(?<stem>.*?[^\d_])_?(?<number>\d+)?$/v.exec(name)?.groups ?? {};
    const words = stem
        .split('_')
        .filter((word) => word !== '')
        .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`);
    return [...words, ...(number === undefined ? [] : [String(Number(number))])].join(' ');
}

/** A caption from a static page, which is HTML as the page held it, with its runs of white space made one space. */
function captionOf(caption: string | undefined): string | null {
    const text = (caption ?? '').replaceAll(/\s+/gv, ' ').trim();
    return text === '' || text === '$comment' ? null : text;
}
