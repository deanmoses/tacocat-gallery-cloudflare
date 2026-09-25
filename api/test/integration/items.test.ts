import { env } from 'cloudflare:workers';
import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { orm, schema, upsertItem } from '../../src/db';
import { callAsAdmin, putItem, storedItem } from '../helpers';

const MEDIA = { itemType: 'media', mediaType: 'image', versionId: 'v1', width: 4, height: 3 } as const;

describe('saving an item', () => {
    const { item } = schema;
    const UNCOMPARED = new Set(['id', 'parentPath', 'createdAt', 'updatedAt']);
    // A value for every column an item of each type may hold, so a column the upsert fails to overwrite shows up. A
    // column the constraints forbid for the type is left null, since the row could not be saved otherwise.
    const STALE_ALBUM: Record<string, unknown> = {
        itemType: 'album',
        mediaType: null,
        title: null,
        description: 'stale',
        summary: 'stale',
        tags: null,
        versionId: null,
        published: true,
        width: null,
        height: null,
        durationSeconds: null,
        thumbnailId: null,
        thumbnailCrop: null,
    };
    const STALE_VIDEO: Record<string, unknown> = {
        itemType: 'media',
        mediaType: 'video',
        title: 'stale',
        description: 'stale',
        summary: null,
        tags: ['stale'],
        versionId: 'stale',
        published: false,
        width: 7,
        height: 7,
        durationSeconds: 7,
        thumbnailId: null,
        thumbnailCrop: { x: 1, y: 1, width: 2, height: 2 },
    };
    const COLUMNS = Object.keys(getTableColumns(item)).filter((key) => !UNCOMPARED.has(key) && key !== 'itemName');

    async function read(parentPath: string, itemName: string): Promise<Record<string, unknown>> {
        const row = await storedItem(parentPath, itemName);
        return Object.fromEntries(Object.entries(row ?? {}).filter(([key]) => !UNCOMPARED.has(key)));
    }

    it.each([
        { what: 'an album', stale: STALE_ALBUM, saved: { itemName: '2001', itemType: 'album' } as const },
        {
            what: 'a video',
            stale: STALE_VIDEO,
            saved: { itemName: 'b.mov', ...MEDIA, mediaType: 'video', durationSeconds: 1 } as const,
        },
    ])(
        'leaves $what as a fresh insert of the same values would, clearing every field left out',
        async ({ stale, saved }) => {
            const database = orm(env.DB);
            const parentPath = saved.itemType === 'album' ? '/' : '/2001/06-15/';
            const fresh = { parentPath: saved.itemType === 'album' ? '/' : '/2001/06-16/' };

            // Both stale rows together name every column, including ones added after this test.
            expect(Object.keys(stale).toSorted()).toStrictEqual(COLUMNS.toSorted());

            await upsertItem(database, { ...stale, ...saved, parentPath }).run();
            await upsertItem(database, { ...saved, parentPath }).run();
            await upsertItem(database, { ...saved, ...fresh }).run();

            await expect(read(parentPath, saved.itemName)).resolves.toStrictEqual(
                await read(fresh.parentPath, saved.itemName),
            );
        },
    );

    it('keeps when an item was made and moves when it was changed', async () => {
        const database = orm(env.DB);
        const saved = { parentPath: '/2001/06-15/', itemName: 'kept.jpg', ...MEDIA };
        await upsertItem(database, saved).run();
        const before = await storedItem(saved.parentPath, saved.itemName);
        // SQLite's clock has millisecond resolution, so the second save lands in a later millisecond.
        await vi.waitFor(async () => {
            await upsertItem(database, { ...saved, title: 'Changed' }).run();
            const after = await storedItem(saved.parentPath, saved.itemName);

            expect(after?.updatedAt).not.toBe(before?.updatedAt);
        });
        const after = await storedItem(saved.parentPath, saved.itemName);

        expect(after?.createdAt).toBe(before?.createdAt);
        // Timestamps in one format compare as text.
        expect(Date.parse(after?.updatedAt ?? '')).toBeGreaterThan(Date.parse(before?.updatedAt ?? ''));
    });
});

describe('saving an item through the API', () => {
    const IMAGE = { itemType: 'media', mediaType: 'image', versionId: 'v1', width: 4, height: 3 } as const;
    const ITEM = { ...IMAGE, parentPath: '/2024/09-01/', itemName: 'a.jpg' } as const;

    it('answers with a bookmark to read the write back with, and no body', async () => {
        const response = await putItem({ ...ITEM, title: 'Saved', thumbnailCrop: { x: 1, y: 1, width: 2, height: 2 } });

        expect(response.status).toBe(204);
        await expect(response.text()).resolves.toBe('');
        expect(response.headers.get('set-cookie')).toMatch(/^d1_bookmark=\S+;/v);
        await expect(storedItem(ITEM.parentPath, ITEM.itemName)).resolves.toMatchObject({
            title: 'Saved',
            thumbnailCrop: { x: 1, y: 1, width: 2, height: 2 },
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
        { name: 'media marked published', body: { ...ITEM, published: true } },
        { name: 'a name spelled jpeg', body: { ...ITEM, itemName: 'a.jpeg' } },
        { name: 'an extension the gallery does not take', body: { ...ITEM, itemName: 'a.txt' } },
        { name: 'a blank title', body: { ...ITEM, title: '  ' } },
        { name: 'no tags in the list', body: { ...ITEM, tags: [] } },
        { name: 'a blank tag', body: { ...ITEM, tags: ['sand', ''] } },
        { name: 'a width of zero', body: { ...ITEM, width: 0 } },
        {
            name: 'a crop that runs off the image',
            body: { ...ITEM, thumbnailCrop: { x: 1, y: 2, width: 3, height: 4 } },
        },
        { name: 'a crop with no area', body: { ...ITEM, thumbnailCrop: { x: 1, y: 2, width: 0, height: 1 } } },
    ])('is refused with $name, and writes nothing', async ({ body }) => {
        const response = await callAsAdmin('/api/item', { method: 'PUT', body: JSON.stringify(body) });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({ errorMessage: expect.any(String) });
        await expect(storedItem(ITEM.parentPath, ITEM.itemName)).resolves.toBeUndefined();
    });

    // What the shared schema cannot see is refused by the database, and named.
    it.each([
        { name: 'an image with a duration', body: { ...ITEM, durationSeconds: 3 }, constraint: 'item_duration_check' },
        {
            name: 'a video without one',
            body: { ...ITEM, itemName: 'a.mov', mediaType: 'video' },
            constraint: 'item_duration_check',
        },
    ])('is refused for $name, naming the constraint', async ({ body, constraint }) => {
        const response = await callAsAdmin('/api/item', { method: 'PUT', body: JSON.stringify(body) });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({
            errorMessage: `CHECK constraint failed: ${constraint}`,
        });
        await expect(storedItem(body.parentPath, body.itemName)).resolves.toBeUndefined();
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
        await expect(response.json()).resolves.toStrictEqual({ errorMessage: expect.stringContaining('day album') });
        await expect(storedItem(body.parentPath, body.itemName)).resolves.toBeUndefined();
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
