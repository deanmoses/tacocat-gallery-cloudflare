import { env } from 'cloudflare:workers';
import { like } from 'drizzle-orm';
import { type GalleryRecord, type ItemWrite, type SearchResponse, parseSearch } from 'tacocat-gallery-shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { orm, schema } from '../../src/db';
import { ftsQuery } from '../../src/gallery/search';
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

        expect(paths(both)).toStrictEqual(['/2024/07-04/b.jpg', '/2024/07-04/a.jpg']);
        expect(paths(one)).toStrictEqual(['/2024/07-04/a.jpg']);
    });

    it.each(['"', 'AND', 'a*', '(felix', 'NOT felix', 'felix OR', 'title:felix', '"felix'])(
        'takes %s as words to look for, not as syntax',
        async (terms) => {
            const response = await call(`/api/search/${encodeURIComponent(terms)}`);
            const found = await parseExactly(response, parseSearch);

            expect(response.status).toBe(200);
            expect(found.total).toBe(0);
        },
    );

    it('refuses a search with no words', async () => {
        const response = await call('/api/search/%20%20');

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({ errorMessage: 'No search terms supplied' });
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

        it('lists matches by gallery path, newest first', async () => {
            const found = await search('picnic');

            expect(found.total).toBe(9);
            expect(paths(found)).toStrictEqual([
                '/2003/06-15/b.jpg',
                '/2003/06-15/a.jpg',
                '/2003/06-15/',
                '/2002/06-15/b.jpg',
                '/2002/06-15/a.jpg',
                '/2002/06-15/',
                '/2001/06-15/b.jpg',
                '/2001/06-15/a.jpg',
                '/2001/06-15/',
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
            expect(paths(between)).toStrictEqual(['/2002/06-15/b.jpg', '/2002/06-15/a.jpg', '/2002/06-15/']);
        });

        it('pages with startAt and pageSize, and says the total every time', async () => {
            const [first, second, last] = await Promise.all([
                search('picnic', 'pageSize=4'),
                search('picnic', 'pageSize=4&startAt=4'),
                search('picnic', 'pageSize=4&startAt=8'),
            ]);

            expect([first.total, second.total, last.total]).toStrictEqual([9, 9, 9]);
            expect(paths(first)).toStrictEqual([
                '/2003/06-15/b.jpg',
                '/2003/06-15/a.jpg',
                '/2003/06-15/',
                '/2002/06-15/b.jpg',
            ]);
            expect(paths(second)).toStrictEqual([
                '/2002/06-15/a.jpg',
                '/2002/06-15/',
                '/2001/06-15/b.jpg',
                '/2001/06-15/a.jpg',
            ]);
            expect(paths(last)).toStrictEqual(['/2001/06-15/']);
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
            expect(paths(found)).toStrictEqual(['/2024/07-10/shown.jpg', '/2024/07-10/']);
        });

        it('shows an admin everything', async () => {
            const found = await search('fajita', '', true);

            expect(found.total).toBe(5);
            expect(paths(found)).toStrictEqual([
                '/2024/07-12/no-album.jpg',
                '/2024/07-11/hidden.jpg',
                '/2024/07-11/',
                '/2024/07-10/shown.jpg',
                '/2024/07-10/',
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

describe(ftsQuery, () => {
    it.each([
        { terms: 'felix', query: '"felix"' },
        { terms: '  felix   beach ', query: '"felix" "beach"' },
        { terms: 'say "hi"', query: '"say" """hi"""' },
        { terms: 'title:felix OR (cat)', query: '"title:felix" "OR" "(cat)"' },
    ])('quotes each word of $terms', ({ terms, query }) => {
        expect(ftsQuery(terms)).toBe(query);
    });
});
