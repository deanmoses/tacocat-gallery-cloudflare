import { applyD1Migrations, reset } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { orm, schema, upsertItem } from '../../src/db';
import { searchItems } from '../../src/items';

// The migration that moved the kind of media out of item_type by rebuilding the table.
const RESHAPE = '20260923223051_two_level_item_type';

describe('the two-level item type migration', () => {
    it('moves the kind of media into media_type, and keeps the search index whole', async () => {
        const { item } = schema;
        const database = orm(env.DB);
        await reset();
        await applyD1Migrations(
            env.DB,
            env.TEST_MIGRATIONS.filter((migration) => migration.name < RESHAPE),
        );
        await env.DB.prepare(
            `INSERT INTO item (parent_path, item_name, item_type, title) VALUES
                ('/', '2001', 'album', 'Year'),
                ('/2001/06-15/', 'a.jpg', 'image', 'Quesadilla'),
                ('/2001/06-15/', 'b.mov', 'video', 'Burrito')`,
        ).run();
        await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
        await upsertItem(database, {
            parentPath: '/2001/06-15/',
            itemName: 'c.jpg',
            itemType: 'media',
            mediaType: 'image',
            title: 'Taco',
        }).run();
        const rows = await database
            .select({ itemName: item.itemName, itemType: item.itemType, mediaType: item.mediaType })
            .from(item)
            .orderBy(item.itemName)
            .all();
        const names = async (word: string): Promise<string[]> =>
            (await searchItems(database, word, true)).results.map((result) => result.itemName);

        expect(rows).toStrictEqual([
            { itemName: '2001', itemType: 'album', mediaType: null },
            { itemName: 'a.jpg', itemType: 'media', mediaType: 'image' },
            { itemName: 'b.mov', itemType: 'media', mediaType: 'video' },
            { itemName: 'c.jpg', itemType: 'media', mediaType: 'image' },
        ]);
        // Rows from before the rebuild are found through the rebuilt index, and one written after it through the
        // recreated triggers.
        await expect(names('burrito')).resolves.toStrictEqual(['b.mov']);
        await expect(names('taco')).resolves.toStrictEqual(['c.jpg']);
    });
});
