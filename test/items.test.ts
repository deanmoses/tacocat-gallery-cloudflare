import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { callAsAdmin, callForJson } from './helpers';

interface SearchResponse {
    count: number;
    results: Record<string, unknown>[];
}

async function putItem(item: Record<string, unknown>): Promise<Response> {
    return callAsAdmin('/api/item', { method: 'PUT', body: JSON.stringify(item) });
}

describe('albums', () => {
    it('lists what an admin saved, and hands back a bookmark', async () => {
        const saved = await putItem({
            parentPath: '/2024/06-15/',
            itemName: 'a.jpg',
            itemType: 'image',
            title: 'Beach',
        });
        const album = await callForJson<{ count: number }>('/api/album/2024/06-15/');

        expect(saved.status).toBe(200);
        expect(saved.headers.get('x-d1-bookmark')).not.toBe('');
        expect(album.count).toBe(1);
    });

    // Rows come straight from D1, so the columns keep their SQL names.
    it('returns the saved fields under their SQL column names', async () => {
        await putItem({ parentPath: '/2024/06-16/', itemName: 'a.jpg', itemType: 'image', title: 'Beach' });
        const album = await callForJson<{ children: Record<string, unknown>[] }>('/api/album/2024/06-16/');

        expect(album.children.at(0)).toMatchObject({ item_name: 'a.jpg', title: 'Beach' });
    });

    it('reads its own write through the bookmark', async () => {
        const { summary } = await callForJson<{ summary: string }>('/api/ryw');

        expect(summary).toMatch(/own true/v);
    });
});

describe('search', () => {
    it('finds an item by a word in its title, with a snippet from its description', async () => {
        await putItem({
            parentPath: '/2024/07-01/',
            itemName: 'taco.jpg',
            itemType: 'image',
            title: 'Taco night',
            description: 'Tacos at home',
        });
        const found = await callForJson<SearchResponse>('/api/search?q=taco');

        expect(found.count).toBe(1);
        expect(found.results.at(0)).toMatchObject({
            item_name: 'taco.jpg',
            title: 'Taco night',
            snippet: 'Tacos at home',
        });
    });

    it('follows an update to the title', async () => {
        const item = { parentPath: '/2024/07-02/', itemName: 'meal.jpg', itemType: 'image' };
        await putItem({ ...item, title: 'Enchilada night' });
        await putItem({ ...item, title: 'Burrito night' });
        const old = await callForJson<SearchResponse>('/api/search?q=enchilada');
        const current = await callForJson<SearchResponse>('/api/search?q=burrito');

        expect(old.count).toBe(0);
        expect(current.count).toBe(1);
    });

    it('keeps the FTS index consistent through writes and deletes', async () => {
        await callAsAdmin('/api/seed?years=1', { method: 'POST' });
        await env.DB.prepare("DELETE FROM item WHERE parent_path LIKE '/2000/01-%'").run();
        const check = env.DB.prepare("INSERT INTO item_fts(item_fts) VALUES('integrity-check')").run();

        await expect(check).resolves.toMatchObject({ success: true });
    });
});

describe('backup', () => {
    it('writes every item to R2 as JSON', async () => {
        await putItem({ parentPath: '/2024/08-01/', itemName: 'c.jpg', itemType: 'image' });
        const response = await callAsAdmin('/api/backup', { method: 'POST' });
        const { key, rows } = await response.json<{ key: string; rows: number }>();
        const count = await env.DB.prepare('SELECT count(*) AS n FROM item').first<number>('n');
        const object = await env.MEDIA.get(key);
        const dump = await object?.json<{ rows: { itemName: string }[] }>();

        // Storage is shared by the tests in a file, so count against the table rather than a fixed number.
        expect(rows).toBe(count);
        expect(dump?.rows).toHaveLength(rows);
        expect(dump?.rows.map((row) => row.itemName)).toContain('c.jpg');
    });
});
