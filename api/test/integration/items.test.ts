import { env } from 'cloudflare:workers';
import { type Column, getTableColumns, like } from 'drizzle-orm';
import { type ItemWrite, type SearchResponse, parseSearch } from 'tacocat-gallery-shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { orm, schema, upsertItem } from '../../src/db';
import { call, callAsAdmin, callForJson, parseExactly, putItem, storedItem } from '../helpers';

const MEDIA = { itemType: 'media', mediaType: 'image', versionId: 'v1', width: 4, height: 3 } as const;

async function search(query: string, asAdmin = false): Promise<SearchResponse> {
    return parseExactly(await (asAdmin ? callAsAdmin : call)(`/api/search?q=${query}`), parseSearch);
}

describe('read-your-writes', () => {
    it('reads its own write through the bookmark', async () => {
        const { summary } = await callForJson<{ summary: string }>('/api/ryw');

        expect(summary).toMatch(/own true/v);
    });
});

describe('saving an item', () => {
    const { item } = schema;
    const UNCOMPARED = new Set(['id', 'parentPath', 'updatedOn']);
    const STALE_BY_TYPE = new Map<Column['dataType'], unknown>([
        ['string', 'stale'],
        ['number', 7],
        ['boolean', true],
        ['json', ['stale']],
    ]);

    // Every column is filled, including ones added after this test, so a column the upsert fails to overwrite shows up.
    function stale(column: Column): unknown {
        if (column.enumValues) return column.enumValues.at(-1);
        if (!STALE_BY_TYPE.has(column.dataType)) {
            throw new Error(`No test value for ${column.name}, a ${column.dataType} column`);
        }
        return STALE_BY_TYPE.get(column.dataType);
    }

    async function read(parentPath: string, itemName: string): Promise<Record<string, unknown>> {
        const row = await storedItem(parentPath, itemName);
        return Object.fromEntries(Object.entries(row ?? {}).filter(([key]) => !UNCOMPARED.has(key)));
    }

    it('leaves an item as a fresh insert of the same values would, clearing every field left out', async () => {
        const database = orm(env.DB);
        const saved = { itemName: 'upsert.jpg', itemType: 'media', mediaType: 'image' } as const;
        const everyField = Object.fromEntries(
            Object.entries(getTableColumns(item))
                .filter(([key]) => key !== 'id' && key !== 'updatedOn')
                .map(([key, column]) => [key, stale(column)]),
        );
        await upsertItem(database, { ...everyField, ...saved, parentPath: '/upsert/' }).run();
        await upsertItem(database, { ...saved, parentPath: '/upsert/' }).run();
        await upsertItem(database, { ...saved, parentPath: '/fresh/' }).run();
        const fresh = await read('/fresh/', saved.itemName);

        await expect(read('/upsert/', saved.itemName)).resolves.toStrictEqual(fresh);
    });
});

describe('saving an item through the API', () => {
    const IMAGE = { itemType: 'media', mediaType: 'image', versionId: 'v1', width: 4, height: 3 } as const;
    const ITEM = { ...IMAGE, parentPath: '/2024/09-01/', itemName: 'a.jpg' } as const;

    it('answers with a bookmark to read the write back with, and no body', async () => {
        const response = await putItem({ ...ITEM, title: 'Saved', thumbnailCrop: { x: 1, y: 2, width: 3, height: 4 } });

        expect(response.status).toBe(204);
        await expect(response.text()).resolves.toBe('');
        expect(response.headers.get('set-cookie')).toMatch(/^d1_bookmark=\S+;/v);
        await expect(storedItem(ITEM.parentPath, ITEM.itemName)).resolves.toMatchObject({
            title: 'Saved',
            thumbnailCrop: { x: 1, y: 2, width: 3, height: 4 },
        });
    });

    // A field left out is cleared, so a misspelled one would silently wipe the field it meant.
    it.each([
        { name: 'a misspelled field', body: { ...ITEM, desription: 'Beach' } },
        { name: 'the row id', body: { ...ITEM, id: 99 } },
        { name: 'the thumbnail row id', body: { ...ITEM, thumbnailId: 1 } },
        { name: 'a field of the wrong type', body: { ...ITEM, title: 5 } },
        { name: 'an unknown item type', body: { ...ITEM, itemType: 'gif' } },
        { name: 'no item type', body: { parentPath: ITEM.parentPath, itemName: ITEM.itemName } },
        { name: 'an unknown media type', body: { ...ITEM, mediaType: 'gif' } },
        { name: 'a media item with no media type', body: { ...ITEM, mediaType: undefined } },
        { name: 'an album with a media type', body: { ...ITEM, itemType: 'album' } },
    ])('is refused with $name, and writes nothing', async ({ body }) => {
        const response = await callAsAdmin('/api/item', { method: 'PUT', body: JSON.stringify(body) });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({ error: expect.any(String) });
        await expect(storedItem(ITEM.parentPath, ITEM.itemName)).resolves.toBeUndefined();
    });

    it.each([
        { name: 'an album that is not a year', body: { parentPath: '/', itemName: 'tacos', itemType: 'album' } },
        { name: 'a day album at the top', body: { parentPath: '/', itemName: '09-01', itemType: 'album' } },
        { name: 'an album inside a day', body: { parentPath: '/2024/09-01/', itemName: '10-02', itemType: 'album' } },
        { name: 'the root album', body: { parentPath: '', itemName: '', itemType: 'album' } },
        { name: 'an album name holding a path', body: { parentPath: '/', itemName: '2024/09-01', itemType: 'album' } },
        {
            name: 'media in a year album',
            body: { ...IMAGE, parentPath: '/2024/', itemName: 'a.jpg' },
        },
        {
            name: 'a parent path with no slash',
            body: { ...IMAGE, parentPath: '/2024/09-01', itemName: 'a.jpg' },
        },
        {
            name: 'a media name holding a path',
            body: { ...IMAGE, parentPath: '/2024/', itemName: '09-01/a.jpg' },
        },
        {
            name: 'an image named as a video',
            body: { ...IMAGE, parentPath: '/2024/09-01/', itemName: 'a.mov' },
        },
        {
            name: 'a video named as an image',
            body: { ...IMAGE, parentPath: '/2024/09-01/', itemName: 'a.jpg', mediaType: 'video' },
        },
    ])('is refused for $name, which no album page could show', async ({ body }) => {
        const response = await callAsAdmin('/api/item', { method: 'PUT', body: JSON.stringify(body) });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({ error: expect.stringContaining('day album') });
        await expect(storedItem(body.parentPath, body.itemName)).resolves.toBeUndefined();
    });
});

/** Searches for `word`, as a guest or as an admin, and names what was found, in name order. */
async function searchNames(word: string, asAdmin = false): Promise<string[]> {
    const { results } = await search(word, asAdmin);
    return results.map((result) => result.itemName).toSorted();
}

describe('search', () => {
    it('finds an item by a word in its title, with a snippet from its description', async () => {
        await putItem({ parentPath: '/2024/', itemName: '07-01', itemType: 'album', published: true });
        await putItem({
            parentPath: '/2024/07-01/',
            itemName: 'quesadilla.jpg',
            ...MEDIA,
            title: 'Quesadilla night',
            description: 'Quesadillas at home',
        });
        const found = await search('quesadilla');

        expect(found).toStrictEqual({
            q: 'quesadilla',
            count: 1,
            results: [
                {
                    itemType: 'media',
                    mediaType: 'image',
                    path: '/2024/07-01/quesadilla.jpg',
                    itemName: 'quesadilla.jpg',
                    title: 'Quesadilla night',
                    snippet: 'Quesadillas at home',
                },
            ],
        });
    });

    it('links an album by its album path', async () => {
        await putItem({
            parentPath: '/2024/',
            itemName: '07-03',
            itemType: 'album',
            summary: 'Tostada',
            published: true,
        });
        const found = await search('tostada');

        expect(found.results).toStrictEqual([
            { itemType: 'album', path: '/2024/07-03/', itemName: '07-03', title: 'Tostada', snippet: null },
        ]);
    });

    it('follows an update to the title', async () => {
        const item: ItemWrite = { ...MEDIA, parentPath: '/2024/07-02/', itemName: 'meal.jpg' };
        await putItem({ parentPath: '/2024/', itemName: '07-02', itemType: 'album', published: true });
        await putItem({ ...item, title: 'Enchilada night' });
        await putItem({ ...item, title: 'Burrito night' });
        const [old, current] = await Promise.all([search('enchilada'), search('burrito')]);

        expect(old.count).toBe(0);
        expect(current.count).toBe(1);
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
                putItem({
                    parentPath: '/2024/07-10/',
                    itemName: 'shown.jpg',
                    ...MEDIA,
                    title: 'Fajita',
                }),
                putItem({
                    parentPath: '/2024/07-11/',
                    itemName: 'hidden.jpg',
                    ...MEDIA,
                    title: 'Fajita',
                }),
                putItem({
                    parentPath: '/2024/07-12/',
                    itemName: 'no-album.jpg',
                    ...MEDIA,
                    title: 'Fajita',
                }),
            ]);
        });

        it('shows a guest published albums and the media in them', async () => {
            await expect(searchNames('fajita')).resolves.toStrictEqual(['07-10', 'shown.jpg']);
        });

        it('shows an admin everything', async () => {
            await expect(searchNames('fajita', true)).resolves.toStrictEqual([
                '07-10',
                '07-11',
                'hidden.jpg',
                'no-album.jpg',
                'shown.jpg',
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

describe('backup', () => {
    it('writes every item to R2 as JSON', async () => {
        await putItem({ ...MEDIA, parentPath: '/2024/08-01/', itemName: 'c.jpg' });
        await putItem({ ...MEDIA, parentPath: '/2024/08-01/', itemName: 'd.jpg' });
        const response = await callAsAdmin('/api/backup', { method: 'POST' });
        const { key, rows } = await response.json<{ key: string; rows: number }>();
        const object = await env.MEDIA.get(key);
        const dump = await object?.json<{ rows: { itemName: string }[] }>();

        expect(rows).toBe(2);
        expect(dump?.rows.map((row) => row.itemName)).toStrictEqual(['c.jpg', 'd.jpg']);
    });
});
