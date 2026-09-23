import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { childrenOf, setThumbnail } from '../../src/albums';
import { type Orm, orm, schema, upsertItem } from '../../src/db';
import { searchItems } from '../../src/items';
import { inSequence } from '../../src/sequence';

// D1 bills by rows read, and an FTS trigger that scanned the whole index on every write once read 37.7M rows in a day.
// Local D1 counts the rows a trigger reads in the meta of the statement that fired it, so a query that scans instead of
// seeking reads thousands of rows here, where the table is gallery-sized.
const OVERHEAD = 10;
const DAYS = 100;
const IMAGES_PER_DAY = 20;

/** The name of the index-th day album of 2001: 01-01, 01-02 and so on. */
function dayName(index: number): string {
    const month = String(Math.floor(index / 28) + 1).padStart(2, '0');
    const day = String((index % 28) + 1).padStart(2, '0');
    return `${month}-${day}`;
}

function dayPath(index: number): string {
    return `/2001/${dayName(index)}/`;
}

async function seedGallery(database: Orm): Promise<void> {
    const days = Array.from({ length: DAYS })
        .keys()
        .map((index) => ({ name: dayName(index), path: dayPath(index) }))
        .toArray();
    await inSequence(days, async (day) =>
        database.batch([
            upsertItem(database, { parentPath: '/2001/', itemName: day.name, itemType: 'album', published: true }),
            ...Array.from({ length: IMAGES_PER_DAY })
                .keys()
                .map((index) =>
                    upsertItem(database, {
                        parentPath: day.path,
                        itemName: `img_${index}.jpg`,
                        itemType: 'image',
                        title: `Taco ${index}`,
                        description: 'Tacos on the beach',
                    }),
                ),
            setThumbnail(
                database,
                { parentPath: '/2001/', itemName: day.name },
                { parentPath: day.path, itemName: 'img_0.jpg' },
            ),
        ]),
    );
}

describe('rows read on a gallery-sized table', () => {
    const { item } = schema;
    let database: Orm;

    beforeEach(async () => {
        database = orm(env.DB);
        await seedGallery(database);
    });

    it.each([
        { what: 'inserting an item', values: { parentPath: '/2001/01-01/', itemName: 'new.jpg', title: 'Quesadilla' } },
        { what: 'updating an item', values: { parentPath: '/2001/01-01/', itemName: 'img_3.jpg', title: 'Burrito' } },
    ])('$what reads a few rows', async ({ values }) => {
        const result = await upsertItem(database, { ...values, itemType: 'image' }).run();

        expect(result.meta.rows_read).toBeLessThanOrEqual(OVERHEAD);
    });

    it('deleting an item reads a few rows', async () => {
        const result = await database
            .delete(item)
            .where(and(eq(item.parentPath, '/2001/01-01/'), eq(item.itemName, 'img_3.jpg')))
            .run();

        // More than one, since changes include what the FTS trigger writes.
        expect(result.meta.changes).toBeGreaterThan(0);
        expect(result.meta.rows_read).toBeLessThanOrEqual(OVERHEAD);
    });

    it.each([dayPath(4), '/2001/'])(
        'reading the album %s reads only its children and their thumbnails',
        async (path) => {
            const { rows, meta } = await childrenOf(database, path);
            const thumbnails = rows.filter((row) => row.thumb_item_name !== null).length;

            expect(rows.length).toBeGreaterThan(0);
            expect(meta.rows_read).toBeLessThanOrEqual(rows.length + thumbnails + OVERHEAD);
        },
    );

    it('setting an album thumbnail reads a few rows', async () => {
        const album = { parentPath: '/2001/', itemName: dayName(4) };
        const result = await setThumbnail(database, album, { parentPath: dayPath(4), itemName: 'img_7.jpg' }).run();

        expect(result.meta.changes).toBeGreaterThan(0);
        expect(result.meta.rows_read).toBeLessThanOrEqual(OVERHEAD);
    });

    it.each([
        { who: 'a guest', admin: false },
        { who: 'an admin', admin: true },
    ])('searching for a rare word as $who reads only its matches', async ({ admin }) => {
        await upsertItem(database, {
            parentPath: dayPath(9),
            itemName: 'q.jpg',
            itemType: 'image',
            title: 'Quesadilla',
        }).run();
        const found = await searchItems(database, 'quesadilla', admin);

        expect(found.results).toHaveLength(1);
        expect(found.meta.rows_read).toBeLessThanOrEqual(found.results.length + OVERHEAD);
    });

    // Every image in the gallery matches, and the best 50 come back.
    it.each([
        { who: 'a guest', admin: false },
        { who: 'an admin', admin: true },
    ])('searching for a common word as $who reads a few rows per result', async ({ admin }) => {
        const found = await searchItems(database, 'taco', admin);

        expect(found.results).toHaveLength(50);
        expect(found.meta.rows_read).toBeLessThanOrEqual(found.results.length * 3 + OVERHEAD);
    });
});
