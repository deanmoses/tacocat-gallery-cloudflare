import { describe, expect, it } from 'vitest';
import type { Gallery2Item } from '../../../scripts/recovery/gallery2.ts';
import { handOrdered, orderChange } from '../../../scripts/recovery/gallery2-order.ts';

function album(fields: Partial<Gallery2Item> & { id: number; parent: number; name: string | null }): Gallery2Item {
    return {
        type: 'GalleryAlbumItem',
        title: null,
        summary: null,
        desc: null,
        order: null,
        albumOrder: null,
        width: null,
        height: null,
        ...fields,
    };
}

function photo(fields: Partial<Gallery2Item> & { id: number; parent: number; name: string }): Gallery2Item {
    return {
        type: 'GalleryPhotoItem',
        title: null,
        summary: null,
        desc: null,
        order: null,
        albumOrder: null,
        width: 1024,
        height: 768,
        ...fields,
    };
}

const TREE = [
    album({ id: 7, parent: 0, name: null }),
    album({ id: 19, parent: 7, name: '2009' }),
    album({ id: 20, parent: 19, name: '11-01' }),
    album({ id: 21, parent: 20, name: 'party', albumOrder: 'orderWeight' }),
    photo({ id: 31, parent: 21, name: 'cake.jpg', order: 3000 }),
    photo({ id: 32, parent: 21, name: 'Arrival.jpg', order: 1000 }),
    photo({ id: 33, parent: 21, name: 'games.jpg', order: 2000 }),
    photo({ id: 34, parent: 21, name: 'bye.jpg', order: 4000 }),
];
const ARRIVAL = { g2: '2009/11-01/party/Arrival.jpg', zen: '2009/10-30/arrival.jpg' };
const MATCHES = [
    ARRIVAL,
    { g2: '2009/11-01/party/games.jpg', zen: '2009/10-30/party-games.jpg' },
    { g2: '2009/11-01/party/bye.jpg', zen: '2009/10-30/bye.jpg' },
];

describe(handOrdered, () => {
    it("orders a hand-ordered album by its weights, under today's names", () => {
        expect(handOrdered(TREE, MATCHES)).toStrictEqual({
            albums: [
                { from: '2009/11-01/party', path: '/2009/10-30/', names: ['arrival', 'party_games', 'cake', 'bye'] },
            ],
            leftAlone: [],
        });
    });

    it('names a photo the move dropped for its Gallery 2 file, since it was brought back under that name', () => {
        expect(handOrdered(TREE, MATCHES).albums[0]?.names).toContain('cake');
    });

    it('passes over an album Gallery 2 showed in name order', () => {
        const byName = TREE.map((item) => (item.id === 21 ? { ...item, albumOrder: null } : item));

        expect(handOrdered(byName, MATCHES)).toStrictEqual({ albums: [], leftAlone: [] });
    });

    it.each([
        {
            name: 'none of whose photos came through Zenphoto',
            tree: TREE,
            matches: [],
            reason: 'none of its photos came through Zenphoto',
        },
        {
            name: 'whose photos went to two albums',
            tree: TREE,
            matches: [ARRIVAL, { g2: '2009/11-01/party/bye.jpg', zen: '2009/11-01/bye.jpg' }],
            reason: 'its photos went to 2009/10-30 and 2009/11-01',
        },
        {
            name: 'ordered by hand again since',
            tree: TREE,
            matches: MATCHES.map((match) => ({ ...match, zen: match.zen.replace('2009/10-30', '2010/01-24') })),
            reason: 'ordered by hand again in a later gallery',
        },
        {
            name: 'with one photo',
            tree: TREE.filter((item) => item.type !== 'GalleryPhotoItem' || item.id === 32),
            matches: MATCHES,
            reason: 'fewer than two photos',
        },
    ])('leaves alone an album $name', ({ tree, matches, reason }) => {
        expect(handOrdered(tree, matches)).toStrictEqual({
            albums: [],
            leftAlone: [{ from: '2009/11-01/party', reason }],
        });
    });
});

describe(orderChange, () => {
    const party = { from: '2009/11-01/party', path: '/2009/10-30/', names: ['arrival', 'party_games', 'cake', 'bye'] };

    it("moves the fewest photos that make the shown order Gallery 2's", () => {
        expect(orderChange(party, ['arrival', 'bye', 'cake', 'party_games'])).toStrictEqual({
            itemNames: ['arrival', 'party_games', 'cake', 'bye'],
            missing: [],
            added: [],
            collided: [],
            moved: 2,
            orderedToday: false,
        });
    });

    it('moves nothing when the album is already in that order', () => {
        expect(orderChange(party, ['arrival', 'party_games', 'cake', 'bye'])).toMatchObject({
            moved: 0,
            orderedToday: true,
        });
    });

    it('leaves out the photos the album lacks, names those it has gained, and orders the rest', () => {
        expect(orderChange(party, ['arrival', 'bye', 'cake', 'speech'])).toStrictEqual({
            itemNames: ['arrival', 'cake', 'bye'],
            missing: ['party_games'],
            added: ['speech'],
            collided: [],
            moved: 1,
            orderedToday: false,
        });
    });

    it.each([
        { name: 'the album lacks', shown: ['arrival', 'bye', 'cake', 'party_games_2'], missing: ['party_games'] },
        { name: 'another item holds', shown: ['arrival', 'bye', 'cake', 'party_games', 'party_games_2'], missing: [] },
    ])(
        "spots a `_n` name beside a photo's, which the copy from AWS gave one of two that collided, where $name",
        ({ shown, missing }) => {
            expect(orderChange(party, shown)).toMatchObject({
                missing,
                added: ['party_games_2'],
                collided: ['party_games'],
            });
        },
    );
});
