import { describe, expect, it } from 'vitest';
import {
    STATIC_ALBUMS,
    type StaticAlbum,
    type StaticItem,
    recoveredStaticAlbum,
    titleOf,
} from '../../../scripts/recovery/static-gallery.ts';

function photo(file: string, caption = ''): StaticItem {
    return { kind: 'photo', file, caption, width: 640, height: 480 };
}

const ALBUM: StaticAlbum = {
    to: '/2002/04-02/',
    draft: true,
    summary: 'Week 16',
    description: '<p>Big progress of the week.</p>',
    photos: [
        { file: '2002/04/02/images/tub1.jpg' },
        { file: '2002/04/02/images/felix-jasper.jpg' },
        { file: '2002/04/02/images/oilivia.jpg', name: 'olivia' },
    ],
};

const ITEMS = [
    photo('2002/04/02/images/tub1.jpg', 'First time in the\n  grown-up tub.'),
    photo('2002/04/02/images/felix-jasper.jpg', 'And, of course, Jasper.'),
    photo('2002/04/02/images/oilivia.jpg', '$comment'),
    { kind: 'unshown image', file: '2002/04/02/images/jasper.jpg' },
];

describe(titleOf, () => {
    it.each([
        { name: 'party01', title: 'Party 1' },
        { name: 'newschool02', title: 'Newschool 2' },
        { name: 'felix_jasper', title: 'Felix Jasper' },
        { name: 'hands4', title: 'Hands 4' },
        { name: 'scrabble', title: 'Scrabble' },
        { name: 'block_00', title: 'Block 0' },
        { name: '01', title: '01' },
    ])('titles $name as $title', ({ name, title }) => {
        expect(titleOf(name)).toBe(title);
    });
});

describe(recoveredStaticAlbum, () => {
    const recovered = recoveredStaticAlbum(ITEMS, ALBUM);

    it('names each photo as an upload would, unless told another name, and sorts them by name', () => {
        expect(recovered.media.map(({ name, path }) => ({ name, path }))).toStrictEqual([
            { name: 'felix_jasper', path: '/2002/04-02/felix_jasper' },
            { name: 'olivia', path: '/2002/04-02/olivia' },
            { name: 'tub1', path: '/2002/04-02/tub1' },
        ]);
        expect(recovered.order).toBeNull();
    });

    it("gives each photo its page's caption, its title from its name, and the static gallery's copy", () => {
        expect(recovered.media.at(-1)).toStrictEqual({
            file: '2002/04-02/tub1.jpg',
            path: '/2002/04-02/tub1',
            name: 'tub1',
            title: 'Tub 1',
            description: 'First time in the grown-up tub.',
            crop: null,
            size: { width: 640, height: 480 },
            bytes: null,
            tags: [],
            copy: '2002/04/02/images/tub1.jpg',
        });
    });

    it("leaves out the generator's empty caption", () => {
        expect(recovered.media.find(({ name }) => name === 'olivia')?.description).toBeNull();
    });

    it('makes a new album unpublished with its words, shown by its first photo', () => {
        expect(recovered).toMatchObject({
            path: '/2002/04-02/',
            draft: true,
            summary: 'Week 16',
            description: '<p>Big progress of the week.</p>',
            thumbnail: '/2002/04-02/felix_jasper',
        });
    });

    it('leaves the thumbnail of an album the gallery has alone', () => {
        const added = recoveredStaticAlbum(ITEMS, {
            ...ALBUM,
            draft: false,
            photos: [{ file: ALBUM.photos[0]?.file ?? '' }],
        });

        expect(added.thumbnail).toBeNull();
    });

    it('stops on a file the inventory lists as no photo', () => {
        expect(() =>
            recoveredStaticAlbum(ITEMS, { ...ALBUM, photos: [{ file: '2002/04/02/images/jasper.jpg' }] }),
        ).toThrow('no photo 2002/04/02/images/jasper.jpg');
    });

    it('stops on two photos of one name', () => {
        expect(() =>
            recoveredStaticAlbum(ITEMS, {
                ...ALBUM,
                photos: [
                    { file: '2002/04/02/images/tub1.jpg' },
                    { file: '2002/04/02/images/oilivia.jpg', name: 'tub1' },
                ],
            }),
        ).toThrow('one name');
    });
});

describe('STATIC_ALBUMS', () => {
    it('brings back the 44 photos Moses chose, into six albums', () => {
        expect(STATIC_ALBUMS.map(({ to, draft, photos }) => [to, draft, photos.length])).toStrictEqual([
            ['/2002/04-02/', true, 20],
            ['/2006/06-04/', true, 5],
            ['/2006/10-21/', true, 16],
            ['/2003/12-11/', true, 1],
            ['/2005/10-23/', false, 1],
            ['/2004/07-24/', false, 1],
        ]);
    });
});
