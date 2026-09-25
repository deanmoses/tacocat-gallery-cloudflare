import { env } from 'cloudflare:workers';
import { and, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    albumExists,
    createAlbum,
    deleteAlbum,
    describeAlbum,
    mediaExists,
    readAlbum,
    renameAlbum,
    setThumbnail,
    updateAlbum,
} from '../../src/gallery/albums';
import { purgeSpentChallenges, spendChallenge } from '../../src/auth/passkeys';
import { type Orm, orm, schema, upsertItem } from '../../src/db';
import { searchItems } from '../../src/gallery/search';
import { deleteMedia, describeMedia, recutThumbnail, renameMedia, updateMedia } from '../../src/gallery/media';
import { presignUploads } from '../../src/gallery/presign';
import { type MediaFacts, type Upload, insertItem, replaceItem } from '../../src/gallery/upload';
import { inSequence } from '../../src/util/sequence';
import { TEST_SECRETS } from '../secrets';

// D1 bills by rows read, and an FTS trigger that scanned the whole index on every write once read 37.7M rows in a day.
// Local D1 counts the rows a trigger reads in the meta of the statement that fired it, so a query that scans instead of
// seeking reads thousands of rows here, where the table is gallery-sized.
const OVERHEAD = 10;
const DAYS = 100;
const IMAGES_PER_DAY = 20;
const IMAGE = { itemType: 'media', mediaType: 'image', versionId: 'v1', width: 4032, height: 3024 } as const;

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
                        ...IMAGE,
                        versionId: `${day.name}-${index}`,
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
    // An empty day, so that deleting an album that uploads point at can be tried.
    await upsertItem(database, { parentPath: '/2001/', itemName: EMPTY_DAY, itemType: 'album', published: true }).run();
    // The upload that made each image, pointing at it and at its day, since a delete's cost through a foreign key
    // shows only when the referencing table has rows.
    await database.run(sql`
        INSERT INTO upload (version_id, parent_path, item_name, album_id, target_id, target_path, username, completed_at)
        SELECT version_id, parent_path, item_name,
            (SELECT day.id FROM item day WHERE day.parent_path || day.item_name || '/' = item.parent_path),
            id, parent_path || item_name, 'moses', created_at
        FROM item WHERE item_type = 'media'`);
    const emptyDay = await database
        .select({ id: schema.item.id })
        .from(schema.item)
        .where(and(eq(schema.item.parentPath, '/2001/'), eq(schema.item.itemName, EMPTY_DAY)))
        .get();
    await database
        .insert(schema.upload)
        .values(
            Array.from({ length: IMAGES_PER_DAY }, (_, index) => ({
                versionId: `pending-${index}`,
                parentPath: dayPath(DAYS),
                itemName: `pending_${index}.jpg`,
                albumId: emptyDay?.id ?? null,
                username: 'moses',
            })),
        )
        .run();
}

const EMPTY_DAY = dayName(DAYS);
const PRESIGN_ENV = { ...TEST_SECRETS, MEDIA_BUCKET: 'test-media' };

/** What the pipeline learned from a file, as the item statements take it. */
const FACTS: MediaFacts = {
    mediaType: 'image',
    title: 'From the file',
    description: null,
    tags: null,
    width: 4032,
    height: 3024,
    durationSeconds: null,
};

/** An upload row as presign writes it, into the day-th album, replacing `targetId` when given. */
async function uploadRow(
    database: Orm,
    day: number,
    itemName: string,
    targetId: number | null = null,
): Promise<Upload> {
    const { item } = schema;
    const album = await database
        .select({ id: item.id })
        .from(item)
        .where(and(eq(item.parentPath, '/2001/'), eq(item.itemName, dayName(day))))
        .get();
    const [row] = await database
        .insert(schema.upload)
        .values({
            versionId: `minted-${itemName}`,
            parentPath: dayPath(day),
            itemName,
            albumId: album?.id ?? null,
            targetId,
            targetPath: targetId === null ? null : `${dayPath(day)}img_3.jpg`,
            username: 'moses',
        })
        .returning();
    if (row === undefined) {
        throw new Error('no upload row');
    }
    return row;
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
        const result = await upsertItem(database, { ...values, ...IMAGE }).run();

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

    // ON DELETE SET NULL has SQLite find every album that points at the deleted row, which needs the index on thumbnail_id.
    it('deleting the media an album shows clears the album, reading a few rows', async () => {
        const result = await database
            .delete(item)
            .where(and(eq(item.parentPath, dayPath(4)), eq(item.itemName, 'img_0.jpg')))
            .run();
        const day = await database
            .select({ thumbnailId: item.thumbnailId })
            .from(item)
            .where(and(eq(item.parentPath, '/2001/'), eq(item.itemName, dayName(4))))
            .get();

        expect(day).toStrictEqual({ thumbnailId: null });
        // The row, what the search index's delete trigger reads, and the album the index on thumbnail_id finds.
        expect(result.meta.rows_read).toBeLessThanOrEqual(2 * OVERHEAD);
    });

    it('deleting an empty day that uploads point at clears them, reading a few rows', async () => {
        const result = await deleteAlbum(database, { parentPath: '/2001/', itemName: EMPTY_DAY });
        const cleared = await database
            .select({ albumId: schema.upload.albumId })
            .from(schema.upload)
            .where(eq(schema.upload.parentPath, dayPath(DAYS)))
            .all();

        expect(result.changes).toBeGreaterThan(0);
        expect(cleared).toStrictEqual(Array.from({ length: IMAGES_PER_DAY }, () => ({ albumId: null })));
        // Clearing each upload costs about five reads, the index entry, the row and its other foreign keys checked
        // again, so the cost follows the uploads ever made into the album, not the size of the upload table.
        expect(result.meta?.rows_read).toBeLessThanOrEqual(5 * IMAGES_PER_DAY + OVERHEAD);
    });

    it('asking for upload URLs reads the album and its children', async () => {
        const result = await presignUploads(
            PRESIGN_ENV,
            database,
            dayPath(4),
            [{ path: `${dayPath(4)}new.jpg` }, { path: `${dayPath(4)}img_3.png`, replaces: `${dayPath(4)}img_3.jpg` }],
            'moses',
        );

        expect('uploads' in result && Object.keys(result.uploads)).toHaveLength(2);
        expect('uploads' in result && result.rowsRead).toBeLessThanOrEqual(IMAGES_PER_DAY + OVERHEAD);
    });

    it('placing a new upload under its album reads a few rows', async () => {
        const upload = await uploadRow(database, 4, 'new.jpg');
        const result = await database.run(insertItem(database, upload.albumId ?? 0, upload, FACTS));

        expect(result.meta.changes).toBeGreaterThan(0);
        expect(result.meta.rows_read).toBeLessThanOrEqual(OVERHEAD);
    });

    it('pointing an item at its replacement reads a few rows', async () => {
        const target = await database
            .select({ id: item.id })
            .from(item)
            .where(and(eq(item.parentPath, dayPath(4)), eq(item.itemName, 'img_3.jpg')))
            .get();
        const upload = await uploadRow(database, 4, 'img_3.png', target?.id ?? null);
        const result = await database.run(replaceItem(database, target?.id ?? 0, upload, FACTS));
        const renamed = await database
            .select({ itemName: item.itemName })
            .from(item)
            .where(eq(item.id, target?.id ?? 0))
            .get();

        expect(result.meta.changes).toBeGreaterThan(0);
        expect(renamed).toStrictEqual({ itemName: 'img_3.png' });
        expect(result.meta.rows_read).toBeLessThanOrEqual(OVERHEAD);
    });

    it('finding the item an object belongs to by its version reads one row', async () => {
        const result = await database
            .select({ parentPath: item.parentPath, itemName: item.itemName })
            .from(item)
            .where(eq(item.versionId, `${dayName(7)}-3`))
            .run();

        expect(result.results).toStrictEqual([{ parent_path: dayPath(7), item_name: 'img_3.jpg' }]);
        // The index entry and the row.
        expect(result.meta.rows_read).toBeLessThanOrEqual(2);
    });

    it.each([
        {
            what: 'publishing an album',
            write: () =>
                database
                    .update(item)
                    .set({ published: false })
                    .where(and(eq(item.parentPath, '/2001/'), eq(item.itemName, dayName(4)))),
        },
        {
            what: 'pointing an item at a new version',
            write: () =>
                database
                    .update(item)
                    .set({ versionId: 'v2' })
                    .where(and(eq(item.parentPath, dayPath(4)), eq(item.itemName, 'img_1.jpg'))),
        },
        {
            what: "moving an album's children on a rename",
            write: () =>
                database
                    .update(item)
                    .set({ parentPath: '/2001/12-31/' })
                    .where(eq(item.parentPath, dayPath(4))),
        },
    ])('$what touches nothing in the search index', async ({ write }) => {
        const result = await write().run();

        expect(result.meta.changes).toBeGreaterThan(0);
        // Each changed row, its unique index entry and its foreign key are read; the row and at most one index entry
        // are written. The search index's update trigger, were it to fire, would write two more rows per change.
        expect(result.meta.rows_read).toBeLessThanOrEqual(3 * result.meta.changes + OVERHEAD);
        expect(result.meta.rows_written).toBeLessThanOrEqual(2 * result.meta.changes);
    });

    // Each write's conditions look at other rows through subqueries, which have to seek.
    it.each([
        {
            what: 'making a day album',
            write: async () => createAlbum(database, { parentPath: '/2001/', itemName: '12-31' }, {}),
        },
        {
            what: 'publishing a day under its year',
            write: async () =>
                updateAlbum(database, { parentPath: '/2001/', itemName: dayName(4) }, { published: true }),
        },
        {
            what: 'deleting an empty day',
            write: async () => {
                await createAlbum(database, { parentPath: '/2001/', itemName: '12-31' }, {});
                return deleteAlbum(database, { parentPath: '/2001/', itemName: '12-31' });
            },
        },
    ])('$what reads a few rows', async ({ write }) => {
        const result = await write();

        // More than one where the search index's trigger wrote too.
        expect(result.changes).toBeGreaterThan(0);
        expect(result.meta?.rows_read).toBeLessThanOrEqual(OVERHEAD);
    });

    it.each([
        {
            what: 'captioning a photo',
            write: async () =>
                updateMedia(database, { parentPath: dayPath(4), itemName: 'img_1.jpg' }, { title: 'Nachos' }),
        },
        {
            what: 'deleting a photo',
            write: async () => deleteMedia(database, { parentPath: dayPath(4), itemName: 'img_1.jpg' }),
        },
        {
            what: 'renaming a photo',
            write: async () => renameMedia(database, { parentPath: dayPath(4), itemName: 'img_1.jpg' }, 'nachos.jpg'),
        },
        {
            what: "recutting a photo's thumbnail",
            write: async () =>
                recutThumbnail(
                    database,
                    { parentPath: dayPath(4), itemName: 'img_1.jpg' },
                    { x: 10, y: 10, width: 50, height: 50 },
                ),
        },
    ])('$what reads a few rows', async ({ write }) => {
        const result = await write();

        expect(result.changes).toBeGreaterThan(0);
        expect(result.meta?.rows_read).toBeLessThanOrEqual(OVERHEAD);
    });

    it('explaining a refused media write reads a few rows', async () => {
        const key = { parentPath: dayPath(4), itemName: 'img_1.jpg' };
        const facts = await describeMedia(database, key, { newName: 'img_2.jpg' });
        const cost = await database
            .select({ id: item.id })
            .from(item)
            .where(and(eq(item.parentPath, key.parentPath), eq(item.itemName, key.itemName)))
            .run();

        expect(facts).toStrictEqual({ exists: true, taken: true });
        expect(cost.meta.rows_read).toBeLessThanOrEqual(OVERHEAD);
    });

    it('refusing to delete a day with photos reads a few rows', async () => {
        const result = await deleteAlbum(database, { parentPath: '/2001/', itemName: dayName(4) });

        expect(result.changes).toBe(0);
        expect(result.meta?.rows_read).toBeLessThanOrEqual(OVERHEAD);
    });

    it('renaming a day moves its photos and reads a few rows besides them', async () => {
        const result = await renameAlbum(database, { parentPath: '/2001/', itemName: dayName(4) }, '12-31');
        const moved = await database
            .select({ id: item.id })
            .from(item)
            .where(eq(item.parentPath, '/2001/12-31/'))
            .run();

        expect(result.changes).toBe(1);
        expect(moved.results).toHaveLength(IMAGES_PER_DAY);
    });

    it('explaining a refused write reads a few rows', async () => {
        const facts = await describeAlbum(
            database,
            { parentPath: '/2001/', itemName: dayName(4) },
            { newName: dayName(5), mediaPath: `${dayPath(4)}img_1.jpg` },
        );
        const cost = await database
            .select({ id: item.id })
            .from(item)
            .where(and(eq(item.parentPath, '/2001/'), eq(item.itemName, dayName(4))))
            .run();

        expect(facts).toStrictEqual({
            exists: true,
            yearPublished: true,
            children: IMAGES_PER_DAY,
            taken: true,
            mediaExists: true,
        });
        expect(cost.meta.rows_read).toBeLessThanOrEqual(OVERHEAD);
    });

    it('setting an album thumbnail reads a few rows', async () => {
        const album = { parentPath: '/2001/', itemName: dayName(4) };
        const result = await setThumbnail(database, album, { parentPath: dayPath(4), itemName: 'img_7.jpg' }).run();

        expect(result.meta.changes).toBeGreaterThan(0);
        expect(result.meta.rows_read).toBeLessThanOrEqual(OVERHEAD);
    });

    it.each([
        { what: 'an album', check: async () => albumExists(database, dayPath(4), false) },
        {
            what: 'a media item',
            check: async () => mediaExists(database, { parentPath: dayPath(4), itemName: 'img_7.jpg' }, false),
        },
    ])('asking whether $what is there for a guest reads a row or two', async ({ check }) => {
        const found = await check();

        expect(found.exists).toBe(true);
        expect(found.meta?.rows_read).toBeLessThanOrEqual(OVERHEAD);
    });

    const SEARCH = { oldestFirst: false, startAt: 0, pageSize: 50 };

    it.each([
        { who: 'a guest', admin: false },
        { who: 'an admin', admin: true },
    ])('searching for a rare word as $who reads only its matches', async ({ admin }) => {
        await upsertItem(database, { parentPath: dayPath(9), itemName: 'q.jpg', ...IMAGE, title: 'Quesadilla' }).run();
        const found = await searchItems(database, { ...SEARCH, terms: 'quesadilla' }, admin);

        expect(found.items).toHaveLength(1);
        expect(found.meta.map((meta) => meta.rows_read)).toStrictEqual([
            expect.toSatisfy((read: number) => read <= OVERHEAD),
            expect.toSatisfy((read: number) => read <= 3 + OVERHEAD),
        ]);
    });

    // Every image in the gallery matches. The page is sorted by path, so every match is read to find it, and the
    // count reads every match too: the index entry and the row, the album besides for a guest, and the thumbnail
    // besides for the page. The rare word above is what tells a scan from this.
    it.each([
        { who: 'a guest', admin: false },
        { who: 'an admin', admin: true },
    ])('searching for a common word as $who reads a few rows per match', async ({ admin }) => {
        const found = await searchItems(database, { ...SEARCH, terms: 'taco' }, admin);
        const matches = DAYS * IMAGES_PER_DAY;

        expect(found.total).toBe(matches);
        expect(found.items).toHaveLength(50);
        expect(found.meta.map((meta) => meta.rows_read)).toStrictEqual([
            expect.toSatisfy((read: number) => read <= matches * 4 + OVERHEAD),
            expect.toSatisfy((read: number) => read <= matches * 5 + OVERHEAD),
        ]);
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
