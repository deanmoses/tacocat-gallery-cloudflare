import { env } from 'cloudflare:workers';
import { type Column, getTableColumns, like } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { orm, schema, upsertItem } from '../../src/db';
import { call, callAsAdmin, callForJson, putItem, storedItem } from '../helpers';

interface SearchResponse {
    count: number;
    results: Record<string, unknown>[];
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
        const saved = { itemName: 'upsert.jpg', itemType: 'album' } as const;
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

/** Searches for `word`, as a guest or as an admin, and names what was found, in name order. */
async function searchNames(word: string, asAdmin = false): Promise<string[]> {
    const response = await (asAdmin ? callAsAdmin : call)(`/api/search?q=${word}`);
    const { results } = await response.json<SearchResponse>();
    return results.map((result) => String(result['item_name'])).toSorted();
}

describe('search', () => {
    it('finds an item by a word in its title, with a snippet from its description', async () => {
        await putItem({ parentPath: '/2024/', itemName: '07-01', itemType: 'album', published: true });
        await putItem({
            parentPath: '/2024/07-01/',
            itemName: 'quesadilla.jpg',
            itemType: 'image',
            title: 'Quesadilla night',
            description: 'Quesadillas at home',
        });
        const found = await callForJson<SearchResponse>('/api/search?q=quesadilla');

        expect(found.count).toBe(1);
        expect(found.results.at(0)).toMatchObject({
            item_name: 'quesadilla.jpg',
            title: 'Quesadilla night',
            snippet: 'Quesadillas at home',
        });
    });

    it('follows an update to the title', async () => {
        const item: schema.NewItem = { parentPath: '/2024/07-02/', itemName: 'meal.jpg', itemType: 'image' };
        await putItem({ parentPath: '/2024/', itemName: '07-02', itemType: 'album', published: true });
        await putItem({ ...item, title: 'Enchilada night' });
        await putItem({ ...item, title: 'Burrito night' });
        const old = await callForJson<SearchResponse>('/api/search?q=enchilada');
        const current = await callForJson<SearchResponse>('/api/search?q=burrito');

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
                    title: 'Fajita',
                    published: true,
                }),
                putItem({
                    parentPath: '/2024/',
                    itemName: '07-11',
                    itemType: 'album',
                    title: 'Fajita',
                    published: false,
                }),
                putItem({ parentPath: '/2024/07-10/', itemName: 'shown.jpg', itemType: 'image', title: 'Fajita' }),
                putItem({ parentPath: '/2024/07-11/', itemName: 'hidden.jpg', itemType: 'image', title: 'Fajita' }),
                putItem({ parentPath: '/2024/07-12/', itemName: 'no-album.jpg', itemType: 'image', title: 'Fajita' }),
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
        await putItem({ parentPath: '/2024/08-01/', itemName: 'c.jpg', itemType: 'image' });
        await putItem({ parentPath: '/2024/08-01/', itemName: 'd.jpg', itemType: 'image' });
        const response = await callAsAdmin('/api/backup', { method: 'POST' });
        const { key, rows } = await response.json<{ key: string; rows: number }>();
        const object = await env.MEDIA.get(key);
        const dump = await object?.json<{ rows: { itemName: string }[] }>();

        expect(rows).toBe(2);
        expect(dump?.rows.map((row) => row.itemName)).toStrictEqual(['c.jpg', 'd.jpg']);
    });
});
