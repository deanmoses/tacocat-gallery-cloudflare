import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readAlbum, setThumbnail } from '../../src/gallery/albums';
import { purgeSpentChallenges, spendChallenge } from '../../src/auth/passkeys';
import { type Orm, orm, schema, upsertItem } from '../../src/db';
import { searchItems } from '../../src/gallery/search';
import { inSequence } from '../../src/util/sequence';

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
    await upsertItem(database, { parentPath: '/', itemName: '2001', itemType: 'album', published: true }).run();
    await inSequence(days, async (day) =>
        database.batch([
            upsertItem(database, { parentPath: '/2001/', itemName: day.name, itemType: 'album', published: true }),
            ...Array.from({ length: IMAGES_PER_DAY })
                .keys()
                .map((index) =>
                    upsertItem(database, {
                        parentPath: day.path,
                        itemName: `img_${index}.jpg`,
                        itemType: 'media',
                        mediaType: 'image',
                        versionId: 'v1',
                        width: 4032,
                        height: 3024,
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
        const result = await upsertItem(database, { ...values, itemType: 'media', mediaType: 'image' }).run();

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
        'reading the album %s for a guest reads its own row, its children and their thumbnails',
        async (path) => {
            const read = await readAlbum(database, path, false);
            const children = read.album?.children ?? [];
            const thumbnails = children.filter((child) => child.itemType === 'album' && child.thumbnail !== undefined);

            expect(children.length).toBeGreaterThan(0);
            expect(read.rowsRead).toBeLessThanOrEqual(children.length + thumbnails.length + OVERHEAD);
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
            itemType: 'media',
            mediaType: 'image',
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

describe('rows read on spent login challenges', () => {
    const EXPIRED = 5;
    let database: Orm;

    // A thousand live challenges is far more than a day of logins, so a scan shows up.
    beforeEach(async () => {
        database = orm(env.DB);
        const now = Date.now();
        const rows = Array.from({ length: 1000 }, (_, index) => ({
            challenge: `challenge-${index}`,
            expiresAt: new Date(now + (index < EXPIRED ? -60_000 : 60_000)).toISOString(),
        }));
        // Fifty rows an insert, since D1 binds at most 100 parameters to a statement.
        const [first, ...rest] = Array.from({ length: 20 }, (_, index) =>
            database.insert(schema.spentChallenge).values(rows.slice(index * 50, (index + 1) * 50)),
        );
        if (first) {
            await database.batch([first, ...rest]);
        }
    });

    it.each([
        { what: 'a new challenge', challenge: 'fresh' },
        { what: 'one already spent', challenge: 'challenge-500' },
    ])('spending $what reads a few rows', async ({ challenge }) => {
        const result = await spendChallenge(database, challenge);

        expect(result.meta.rows_read).toBeLessThanOrEqual(OVERHEAD);
    });

    it('purging reads only the expired challenges', async () => {
        vi.spyOn(console, 'info').mockReturnValue();
        const result = await purgeSpentChallenges(database);

        expect(result.meta.changes).toBe(EXPIRED);
        expect(result.meta.rows_read).toBeLessThanOrEqual(EXPIRED + OVERHEAD);
    });
});
