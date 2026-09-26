import { env } from 'cloudflare:workers';
import { like } from 'drizzle-orm';
import { type GalleryRecord, type ItemWrite, type SearchResponse, parseSearch } from 'tacocat-gallery-shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { orm, schema } from '../../src/db';
import { call, callAsAdmin, parseExactly, putItem } from '../helpers';

const MEDIA = { itemType: 'media', mediaType: 'image', versionId: 'v1', width: 4, height: 3 } as const;

/** Searches as the web app does, with its URL, as a guest or as an admin. */
async function search(terms: string, params = '', asAdmin = false): Promise<SearchResponse> {
    const path = `/api/search/${encodeURIComponent(terms)}${params === '' ? '' : `?${params}`}`;
    return parseExactly(await (asAdmin ? callAsAdmin : call)(path), parseSearch);
}

function paths(found: SearchResponse): string[] {
    return found.items.map((item) => item.path);
}

describe('search', () => {
    it('answers with full records, so the app can draw a thumbnail for each match', async () => {
        await putItem({ parentPath: '/2024/', itemName: '07-01', itemType: 'album', published: true });
        await putItem({
            parentPath: '/2024/07-01/',
            itemName: 'quesadilla.jpg',
            ...MEDIA,
            title: 'Quesadilla night',
            description: 'Quesadillas at home',
            tags: ['dinner'],
            thumbnailCrop: { x: 0, y: 0, width: 3, height: 3 },
        });
        const found = await search('quesadilla');

        expect(found).toStrictEqual({
            total: 1,
            items: [
                {
                    itemType: 'media',
                    mediaType: 'image',
                    path: '/2024/07-01/quesadilla.jpg',
                    parentPath: '/2024/07-01/',
                    itemName: 'quesadilla.jpg',
                    updatedOn: expect.any(String),
                    versionId: 'v1',
                    dimensions: { width: 4, height: 3 },
                    thumbnail: { x: 0, y: 0, width: 3, height: 3 },
                    title: 'Quesadilla night',
                    description: 'Quesadillas at home',
                    tags: ['dinner'],
                } satisfies GalleryRecord,
            ],
        });
    });

    it('finds an album by its summary, with the thumbnail its record carries', async () => {
        await putItem({
            parentPath: '/2024/',
            itemName: '07-03',
            itemType: 'album',
            summary: 'Tostada',
            published: true,
        });
        await putItem({ parentPath: '/2024/07-03/', itemName: 'a.jpg', ...MEDIA });
        await callAsAdmin('/api/album-thumb/2024/07-03/', {
            method: 'PATCH',
            body: JSON.stringify({ mediaPath: '/2024/07-03/a.jpg' }),
        });
        const found = await search('tostada');

        expect(found.items).toStrictEqual([
            {
                itemType: 'album',
                path: '/2024/07-03/',
                parentPath: '/2024/',
                itemName: '07-03',
                updatedOn: expect.any(String),
                published: true,
                summary: 'Tostada',
                thumbnail: { path: '/2024/07-03/a.jpg', versionId: 'v1' },
            },
        ]);
    });

    it('follows an update to the title', async () => {
        const item: ItemWrite = { ...MEDIA, parentPath: '/2024/07-02/', itemName: 'meal.jpg' };
        await putItem({ parentPath: '/2024/', itemName: '07-02', itemType: 'album', published: true });
        await putItem({ ...item, title: 'Enchilada night' });
        await putItem({ ...item, title: 'Burrito night' });
        const [old, current] = await Promise.all([search('enchilada'), search('burrito')]);

        expect(old.total).toBe(0);
        expect(current.total).toBe(1);
    });

    it('needs every word to match', async () => {
        await putItem({ parentPath: '/2024/', itemName: '07-04', itemType: 'album', published: true });
        await putItem({ parentPath: '/2024/07-04/', itemName: 'a.jpg', ...MEDIA, title: 'Felix on the beach' });
        await putItem({ parentPath: '/2024/07-04/', itemName: 'b.jpg', ...MEDIA, title: 'Felix at home' });
        const [both, one] = await Promise.all([search('felix'), search('felix beach')]);

        expect(paths(both)).toStrictEqual(['/2024/07-04/a.jpg', '/2024/07-04/b.jpg']);
        expect(paths(one)).toStrictEqual(['/2024/07-04/a.jpg']);
    });

    it.each(['(felix', 'NOT felix', 'felix OR', 'title:felix', '"felix', 'felix)', '@title:felix'])(
        'answers %s, whatever the syntax makes of it',
        async (terms) => {
            const response = await call(`/api/search/${encodeURIComponent(terms)}`);
            const found = await parseExactly(response, parseSearch);

            expect(response.status).toBe(200);
            expect(found.total).toBe(0);
        },
    );

    it.each([
        { terms: '  ', errorMessage: 'No search terms supplied' },
        { terms: 'the', errorMessage: 'No search terms supplied' },
        { terms: '"', errorMessage: 'No search terms supplied' },
        { terms: 'a*', errorMessage: 'No search terms supplied' },
        { terms: '-felix', errorMessage: 'A search needs a word to look for, not only words to leave out' },
        {
            terms: '@caption:felix',
            errorMessage: 'No search field named [caption]; the fields are name, title, description, tags, summary',
        },
        {
            terms: `${'('.repeat(9)}felix${')'.repeat(9)}`,
            errorMessage: 'A search can nest parentheses at most 8 deep',
        },
        {
            terms: Array.from({ length: 33 }, (_, index) => `w${index}`).join(' '),
            errorMessage: 'A search can have at most 32 words and phrases',
        },
    ])('refuses $terms, saying why', async ({ terms, errorMessage }) => {
        const response = await call(`/api/search/${encodeURIComponent(terms)}`);

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({ errorMessage });
    });

    describe('with the syntax', () => {
        const DAY = '/2024/07-05/';
        const ITEM = { parentPath: DAY, ...MEDIA } as const;

        beforeEach(async () => {
            await putItem({ parentPath: '/2024/', itemName: '07-05', itemType: 'album', published: true });
            await Promise.all([
                putItem({ ...ITEM, itemName: 'a.jpg', title: 'Felix on the beach', tags: ['sand'] }),
                putItem({ ...ITEM, itemName: 'b.jpg', title: 'Beach Felix' }),
                putItem({ ...ITEM, itemName: 'c.jpg', title: 'Milo at home', description: 'With Felix' }),
                putItem({ ...ITEM, itemName: 'd.mp4', mediaType: 'video', durationSeconds: 9, title: 'Felix swims' }),
                putItem({ ...ITEM, itemName: 'e.jpg', title: 'Beach alone' }),
                putItem({ ...ITEM, itemName: 'pat1.jpg' }),
                putItem({ ...ITEM, itemName: 'IMG_0715.jpg' }),
                putItem({ ...ITEM, itemName: 'school.jpg', title: 'École' }),
                putItem({ ...ITEM, itemName: 'trip.jpg', title: 'Vacation', description: 'A celebration' }),
            ]);
        });

        function names(found: SearchResponse): string[] {
            return found.items.map((item) => item.itemName);
        }

        it.each([
            { terms: 'beach felix', names: ['a.jpg', 'b.jpg'], what: 'words anywhere, in any order' },
            { terms: '"beach felix"', names: ['b.jpg'], what: 'a phrase in order' },
            { terms: 'fel*', names: ['a.jpg', 'b.jpg', 'c.jpg', 'd.mp4'], what: 'a prefix' },
            { terms: 'beach -felix', names: ['e.jpg'], what: 'a word to leave out' },
            { terms: 'home | swims', names: ['c.jpg', 'd.mp4'], what: 'either of two words' },
            { terms: '@title:felix', names: ['a.jpg', 'b.jpg', 'd.mp4'], what: 'a word in one field' },
            { terms: '@description:felix', names: ['c.jpg'], what: 'a word in another field' },
            { terms: '@title|tags:sand', names: ['a.jpg'], what: 'a word in either of two fields' },
            { terms: '(home | swims) -milo', names: ['d.mp4'], what: 'a group' },
            { terms: 'felix (-milo)', names: ['a.jpg', 'b.jpg', 'd.mp4'], what: 'a word left out inside a group' },
            { terms: 'beach @title:-felix', names: ['e.jpg'], what: 'a word left out of one field' },
        ])('finds $what: $terms', async ({ terms, names: expected }) => {
            expect(names(await search(terms))).toStrictEqual(expected);
        });

        it.each([
            { terms: 'felix at the beach', names: ['a.jpg', 'b.jpg'], what: 'stop words among the words are dropped' },
            { terms: '"felix on the beach"', names: ['a.jpg'], what: 'stop words in a phrase count' },
            { terms: 'beaches', names: ['a.jpg', 'b.jpg', 'e.jpg'], what: 'a word matches its other forms' },
            { terms: 'vacati*', names: ['trip.jpg'], what: 'a prefix matches the word as typed, past its stem' },
            { terms: 'celebrati*', names: ['trip.jpg'], what: 'in any field' },
            { terms: 'vacat*', names: ['trip.jpg'], what: 'and short of it' },
            { terms: 'ecole', names: ['school.jpg'], what: 'an accent need not be typed' },
            { terms: 'ÉCOLE', names: ['school.jpg'], what: 'nor case' },
            { terms: 'felix video', names: ['d.mp4'], what: 'a video is a video, a movie and a clip' },
            {
                terms: 'felix photo',
                names: ['a.jpg', 'b.jpg', 'c.jpg'],
                what: 'a photo is a photo, an image and a picture',
            },
            { terms: 'pat', names: ['pat1.jpg'], what: 'the letters of a file name are a word' },
            { terms: 'pat1', names: ['pat1.jpg'], what: 'so is the name as typed' },
            { terms: '0715', names: ['IMG_0715.jpg'], what: 'and so are the digits' },
            { terms: 'img', names: ['IMG_0715.jpg'], what: 'an underscore parts words' },
        ])('$what: $terms', async ({ terms, names: expected }) => {
            expect(names(await search(terms))).toStrictEqual(expected);
        });

        it('indexes a renamed file under its new name', async () => {
            await callAsAdmin(`/api/media-rename${DAY}pat1.jpg`, {
                method: 'POST',
                body: JSON.stringify({ newName: 'nachos2.jpg' }),
            });
            const [before, after] = await Promise.all([search('pat'), search('nachos')]);

            expect(names(before)).toStrictEqual([]);
            expect(names(after)).toStrictEqual(['nachos2.jpg']);
        });
    });

    describe('over several years', () => {
        beforeEach(async () => {
            const days = [
                ['2001', '06-15'],
                ['2002', '06-15'],
                ['2003', '06-15'],
            ] as const;
            await Promise.all(
                days.flatMap(([year, day]) => [
                    putItem({ parentPath: '/', itemName: year, itemType: 'album', published: true }),
                    putItem({
                        parentPath: `/${year}/`,
                        itemName: day,
                        itemType: 'album',
                        summary: 'Picnic',
                        published: true,
                    }),
                    putItem({ parentPath: `/${year}/${day}/`, itemName: 'a.jpg', ...MEDIA, title: 'Picnic' }),
                    putItem({ parentPath: `/${year}/${day}/`, itemName: 'b.jpg', ...MEDIA, title: 'Picnic' }),
                ]),
            );
        });

        it('lists the days newest first, each with its album first and its media in album order', async () => {
            const found = await search('picnic');

            expect(found.total).toBe(9);
            expect(paths(found)).toStrictEqual([
                '/2003/06-15/',
                '/2003/06-15/a.jpg',
                '/2003/06-15/b.jpg',
                '/2002/06-15/',
                '/2002/06-15/a.jpg',
                '/2002/06-15/b.jpg',
                '/2001/06-15/',
                '/2001/06-15/a.jpg',
                '/2001/06-15/b.jpg',
            ]);
        });

        it('lists them oldest first when asked', async () => {
            const found = await search('picnic', 'oldestFirst=true');

            expect(paths(found).slice(0, 3)).toStrictEqual(['/2001/06-15/', '/2001/06-15/a.jpg', '/2001/06-15/b.jpg']);
        });

        it('keeps to the years asked for, and counts only those', async () => {
            const [from, to, between] = await Promise.all([
                search('picnic', 'oldest=2002'),
                search('picnic', 'newest=2001'),
                search('picnic', 'oldest=2002&newest=2002'),
            ]);

            expect(from.total).toBe(6);
            expect(paths(from).every((path) => !path.startsWith('/2001/'))).toBe(true);
            expect(to.total).toBe(3);
            expect(paths(to).every((path) => path.startsWith('/2001/'))).toBe(true);
            expect(paths(between)).toStrictEqual(['/2002/06-15/', '/2002/06-15/a.jpg', '/2002/06-15/b.jpg']);
        });

        it('lists a year album after its days newest first, and before them oldest first', async () => {
            await putItem({ parentPath: '/', itemName: '2002', itemType: 'album', published: true, summary: 'Picnic' });
            const [newest, oldest] = await Promise.all([search('picnic'), search('picnic', 'oldestFirst=true')]);

            expect(paths(newest).slice(3, 7)).toStrictEqual([
                '/2002/06-15/',
                '/2002/06-15/a.jpg',
                '/2002/06-15/b.jpg',
                '/2002/',
            ]);
            expect(paths(oldest).slice(3, 5)).toStrictEqual(['/2002/', '/2002/06-15/']);
        });

        it('pages with startAt and pageSize, and says the total every time', async () => {
            const [first, second, last] = await Promise.all([
                search('picnic', 'pageSize=4'),
                search('picnic', 'pageSize=4&startAt=4'),
                search('picnic', 'pageSize=4&startAt=8'),
            ]);

            expect([first.total, second.total, last.total]).toStrictEqual([9, 9, 9]);
            expect(paths(first)).toStrictEqual([
                '/2003/06-15/',
                '/2003/06-15/a.jpg',
                '/2003/06-15/b.jpg',
                '/2002/06-15/',
            ]);
            expect(paths(second)).toStrictEqual([
                '/2002/06-15/a.jpg',
                '/2002/06-15/b.jpg',
                '/2001/06-15/',
                '/2001/06-15/a.jpg',
            ]);
            expect(paths(last)).toStrictEqual(['/2001/06-15/b.jpg']);
        });

        it.each(['oldest=99', 'newest=abcd', 'startAt=-1', 'pageSize=0', 'pageSize=101'])(
            'refuses %s',
            async (params) => {
                const response = await call(`/api/search/picnic?${params}`);

                expect(response.status).toBe(400);
                await expect(response.json()).resolves.toStrictEqual({ errorMessage: expect.any(String) });
            },
        );
    });

    describe('as the album pages decide what a guest sees', () => {
        beforeEach(async () => {
            await Promise.all([
                putItem({
                    parentPath: '/2024/',
                    itemName: '07-10',
                    itemType: 'album',
                    summary: 'Fajita',
                    published: true,
                }),
                putItem({
                    parentPath: '/2024/',
                    itemName: '07-11',
                    itemType: 'album',
                    summary: 'Fajita',
                    published: false,
                }),
                putItem({ parentPath: '/2024/07-10/', itemName: 'shown.jpg', ...MEDIA, title: 'Fajita' }),
                putItem({ parentPath: '/2024/07-11/', itemName: 'hidden.jpg', ...MEDIA, title: 'Fajita' }),
                putItem({ parentPath: '/2024/07-12/', itemName: 'no-album.jpg', ...MEDIA, title: 'Fajita' }),
            ]);
        });

        it('shows a guest published albums and the media in them', async () => {
            const found = await search('fajita');

            expect(found.total).toBe(2);
            expect(paths(found)).toStrictEqual(['/2024/07-10/', '/2024/07-10/shown.jpg']);
        });

        it('shows an admin everything', async () => {
            const found = await search('fajita', '', true);

            expect(found.total).toBe(5);
            expect(paths(found)).toStrictEqual([
                '/2024/07-12/no-album.jpg',
                '/2024/07-11/',
                '/2024/07-11/hidden.jpg',
                '/2024/07-10/',
                '/2024/07-10/shown.jpg',
            ]);
        });
    });

    it('keeps the FTS index consistent through writes and deletes', async () => {
        await callAsAdmin('/api/seed?years=1', { method: 'POST' });
        await orm(env.DB).delete(schema.item).where(like(schema.item.parentPath, '/2000/01-%'));
        // FTS5's integrity check is a command written as an insert into the index, which Drizzle cannot model.
        const check = env.DB.prepare("INSERT INTO item_fts(item_fts) VALUES('integrity-check')").run();

        await expect(check).resolves.toMatchObject({ success: true });
    });
});
