import { type SQL, and, asc, eq, exists, isNull, notExists, sql } from 'drizzle-orm';
import { type SQLiteUpdate, alias } from 'drizzle-orm/sqlite-core';
import * as valibot from 'valibot';
import {
    type AlbumGalleryItem,
    type AlbumWrite,
    type ItemKey,
    albumKey,
    albumPath,
    mediaKey,
} from 'tacocat-gallery-shared';
import { type Orm, batchRun, schema } from '../db';
import { type Row, type Selection, selectRecords, selectRecordsBatch, toAlbumRecord, toRecord } from './records';
import { type Written, caption, isKey, written } from './writes';

export interface AlbumRead {
    album: AlbumGalleryItem | null;
    meta: D1Meta;
    rowsRead: number;
    d1Ms: number;
}

/** Whether something is there, with what the lookup read; the root album is not a row and reads nothing. */
export interface Existence {
    exists: boolean;
    meta: D1Meta | null;
}

const ALBUM = alias(schema.item, 'album');

/**
 * The album at `path` with its children, as `admin` or a guest sees it. Nothing in it comes from outside the album's
 * own subtree, so a sibling changing leaves it as it was; the web app finds prev and next in the parent's children.
 * Guests see published albums only; media shows whenever its album does, since publishing is decided per album.
 */
export async function readAlbum(database: Orm, path: string, admin: boolean): Promise<AlbumRead> {
    const { item } = schema;
    const key = albumKey(path);
    const started = performance.now();
    // Both go to D1 in one batch, which runs them in one transaction on one instance: consecutive requests from a colo
    // can be answered by different instances, so two statements could read the album from one and its children from
    // another, or straddle a write. It is no faster than two statements sent at once, since a request costs one round
    // trip whatever it holds. The root is not a row, so its read is its children alone.
    const children = selection(eq(item.parentPath, path));
    const [childRows, selfRows] =
        key === null
            ? [await selectRecords(database, children), null]
            : await selectRecordsBatch(database, [
                  children,
                  selection(and(eq(item.parentPath, key.parentPath), eq(item.itemName, key.itemName))),
              ]);
    const d1Ms = performance.now() - started;
    return {
        album: assemble(childRows.rows, selfRows?.rows ?? null, admin),
        meta: childRows.meta,
        rowsRead: childRows.meta.rows_read + (selfRows?.meta.rows_read ?? 0),
        d1Ms,
    };
}

/** Whether the album at `path` is there for `admin` or a guest to see, without reading it. */
export async function albumExists(database: Orm, path: string, admin: boolean): Promise<Existence> {
    const { item } = schema;
    const key = albumKey(path);
    if (key === null) {
        return { exists: true, meta: null };
    }
    const found = await database
        .select({ id: item.id })
        .from(item)
        .where(
            and(
                eq(item.parentPath, key.parentPath),
                eq(item.itemName, key.itemName),
                eq(item.itemType, 'album'),
                ...(admin ? [] : [eq(item.published, true)]),
            ),
        )
        .run();
    return { exists: found.results.length > 0, meta: found.meta };
}

/** Whether the media item at `key` is there for `admin` or a guest to see: a guest sees it if its album is published. */
export async function mediaExists(database: Orm, key: ItemKey, admin: boolean): Promise<Existence> {
    const { item } = schema;
    const album = albumKey(key.parentPath);
    const albumPublished =
        album === null
            ? sql`0`
            : exists(
                  database
                      .select({ id: ALBUM.id })
                      .from(ALBUM)
                      .where(
                          and(
                              eq(ALBUM.parentPath, album.parentPath),
                              eq(ALBUM.itemName, album.itemName),
                              eq(ALBUM.published, true),
                          ),
                      ),
              );
    const found = await database
        .select({ id: item.id })
        .from(item)
        .where(
            and(
                eq(item.parentPath, key.parentPath),
                eq(item.itemName, key.itemName),
                eq(item.itemType, 'media'),
                ...(admin ? [] : [albumPublished]),
            ),
        )
        .run();
    return { exists: found.results.length > 0, meta: found.meta };
}

/** Makes the album, with what the admin wrote about it. Changes no row if one is there already. */
export async function createAlbum(database: Orm, key: ItemKey, fields: AlbumWrite): Promise<Written> {
    const { item } = schema;
    const result = await database
        .insert(item)
        .values({ ...key, itemType: 'album', ...toColumns(fields) })
        .onConflictDoNothing({ target: [item.parentPath, item.itemName] })
        .run();
    return written(result);
}

/**
 * Changes what the admin wrote about the album. A day album is published only while its year is, which is a condition
 * of the statement, so the row is left as it was when the year is not.
 */
export async function updateAlbum(database: Orm, key: ItemKey, fields: AlbumWrite): Promise<Written> {
    const { item } = schema;
    const year = albumKey(key.parentPath);
    const yearPublished =
        fields.published === true && year !== null
            ? [
                  exists(
                      database
                          .select({ id: ALBUM.id })
                          .from(ALBUM)
                          .where(and(isKey(ALBUM, year), eq(ALBUM.published, true))),
                  ),
              ]
            : [];
    const result = await database
        .update(item)
        .set(toColumns(fields))
        .where(and(isKey(item, key), eq(item.itemType, 'album'), ...yearPublished))
        .run();
    return written(result);
}

/** Removes the album, unless something is in it. */
export async function deleteAlbum(database: Orm, key: ItemKey): Promise<Written> {
    const { item } = schema;
    const children = database
        .select({ id: ALBUM.id })
        .from(ALBUM)
        .where(eq(ALBUM.parentPath, albumPath(key.parentPath, key.itemName)));
    const result = await database
        .delete(item)
        .where(and(isKey(item, key), eq(item.itemType, 'album'), notExists(children)))
        .run();
    return written(result);
}

/**
 * Renames a day album, moving everything in it, as one batch: the children first, then the album, each on the
 * condition that the album is there and nothing has the new name yet, so that a batch in which the rename cannot
 * happen moves nothing either. Thumbnails point at rows by id, so the albums that show one of the moved photos keep
 * it.
 */
export async function renameAlbum(database: Orm, key: ItemKey, newName: string): Promise<Written> {
    const { item } = schema;
    const renamed = { parentPath: key.parentPath, itemName: newName };
    const canRename = and(
        exists(
            database
                .select({ id: ALBUM.id })
                .from(ALBUM)
                .where(and(isKey(ALBUM, key), eq(ALBUM.itemType, 'album'))),
        ),
        notExists(database.select({ id: ALBUM.id }).from(ALBUM).where(isKey(ALBUM, renamed))),
    );
    const [, album] = await database.batch([
        database
            .update(item)
            .set({ parentPath: albumPath(renamed.parentPath, renamed.itemName) })
            .where(and(eq(item.parentPath, albumPath(key.parentPath, key.itemName)), canRename))
            .returning({ id: item.id }),
        database
            .update(item)
            .set({ itemName: newName })
            .where(and(isKey(item, key), eq(item.itemType, 'album'), canRename))
            .returning({ id: item.id }),
    ]);
    return { changes: album.length, meta: null };
}

/** What a write that changed nothing can be told: whether the album is there and what stood in the way. */
export interface AlbumFacts {
    exists: boolean;
    /** Null for a year album, which has no year above it. */
    yearPublished: boolean | null;
    children: number;
    /** Whether an album of `newName` is there beside this one. */
    taken: boolean;
    /** Whether `mediaPath` names a media item. */
    mediaExists: boolean;
}

const FACTS = valibot.array(
    valibot.object({
        found: valibot.nullable(valibot.number()),
        year_published: valibot.nullable(valibot.number()),
        children: valibot.number(),
        taken: valibot.nullable(valibot.number()),
        media_found: valibot.nullable(valibot.number()),
    }),
);

/** One read that answers why a write to the album at `key` changed nothing. */
export async function describeAlbum(
    database: Orm,
    key: ItemKey,
    { newName = '', mediaPath = '' }: { newName?: string; mediaPath?: string } = {},
): Promise<AlbumFacts> {
    const { item } = schema;
    const year = albumKey(key.parentPath);
    const path = albumPath(key.parentPath, key.itemName);
    const media = mediaKey(mediaPath) ?? { parentPath: '', itemName: '' };
    // A builder is changed by what is called on it, so each subquery starts from its own.
    const found = (where: SQL): SQL => sql`(${database.select({ id: item.id }).from(item).where(where)})`;
    const result = await database.run(
        sql`SELECT
            ${found(and(isKey(item, key), eq(item.itemType, 'album')) ?? sql`1`)} AS found,
            (${year === null ? sql`NULL` : database.select({ published: item.published }).from(item).where(isKey(item, year))}) AS year_published,
            (${database
                .select({ count: sql`count(*)` })
                .from(item)
                .where(eq(item.parentPath, path))}) AS children,
            ${found(isKey(item, { parentPath: key.parentPath, itemName: newName }))} AS taken,
            ${found(and(isKey(item, media), eq(item.itemType, 'media')) ?? sql`1`)} AS media_found`,
    );
    const [facts] = valibot.parse(FACTS, result.results);
    return {
        exists: facts?.found !== null && facts?.found !== undefined,
        yearPublished: year === null ? null : facts?.year_published === 1,
        children: facts?.children ?? 0,
        taken: facts?.taken !== null && facts?.taken !== undefined,
        mediaExists: facts?.media_found !== null && facts?.media_found !== undefined,
    };
}

/** The columns an album write sets: a caption that is blank once trimmed clears its field. */
function toColumns(fields: AlbumWrite): Pick<schema.NewItem, 'description' | 'summary' | 'published'> {
    return {
        ...('description' in fields && { description: caption(fields.description) }),
        ...('summary' in fields && { summary: caption(fields.summary) }),
        ...(fields.published !== undefined && { published: fields.published }),
    };
}

/**
 * Points `album` at `media` as its thumbnail. Changes no row unless both exist, or, with `onlyIfNone`, if the album
 * already has one.
 */
export function setThumbnail(
    database: Orm,
    album: ItemKey,
    media: ItemKey,
    { onlyIfNone = false }: { onlyIfNone?: boolean } = {},
): SQLiteUpdate<typeof schema.item, 'async', D1Result> {
    const { item } = schema;
    const mediaId = database
        .select({ id: ALBUM.id })
        .from(ALBUM)
        .where(and(isKey(ALBUM, media), eq(ALBUM.itemType, 'media')));
    return database
        .update(item)
        .set({ thumbnailId: sql`(${mediaId})` })
        .$dynamic()
        .where(
            and(
                isKey(item, album),
                eq(item.itemType, 'album'),
                exists(mediaId),
                ...(onlyIfNone ? [isNull(item.thumbnailId)] : []),
            ),
        );
}

/**
 * The items matching `where`, in name order, each with its thumbnail's row beside it. The index on the path gives that
 * order for nothing; sorting on where an admin placed each item in SQL would pass every row through a sort, which D1
 * counts as reading it again, so the rows are placed after the read.
 */
function selection(where: SQL | undefined): Selection {
    return { where, orderBy: [asc(schema.item.itemName)] };
}

/**
 * Puts the album's media in the order of `itemNames`, or back in name order when that is null. Media not named, such
 * as an upload that finished after the admin loaded the album, is left without a place and follows the rest. Changes
 * no row unless the album has media.
 *
 * A new order clears the old places first, in the same batch: no two media of an album may share a place, and SQLite
 * holds that after every row it updates, so one statement moving items past each other fails on the way.
 */
export async function orderAlbum(database: Orm, key: ItemKey, itemNames: string[] | null): Promise<Written> {
    const { item } = schema;
    const inAlbum = and(eq(item.parentPath, albumPath(key.parentPath, key.itemName)), eq(item.itemType, 'media'));
    const clear = database.update(item).set({ position: null }).where(inAlbum);
    if (itemNames === null) {
        return written(await clear.run());
    }
    const place = database
        .update(item)
        .set({ position: placeOf(itemNames) })
        .where(inAlbum);
    const [cleared, placed] = await batchRun(database, [clear, place]);
    if (cleared === undefined || placed === undefined) {
        throw new Error('D1 answered a batch of two statements with fewer results');
    }
    // What the batch cost, on the last statement's account of where and how long.
    return written({
        ...placed,
        meta: {
            ...placed.meta,
            rows_read: cleared.meta.rows_read + placed.meta.rows_read,
            rows_written: cleared.meta.rows_written + placed.meta.rows_written,
            duration: cleared.meta.duration + placed.meta.duration,
        },
    });
}

/** Where an admin placed each item, then the rest; the sort is stable, so each part keeps the name order it came in. */
function inAlbumOrder(first: Row, second: Row): number {
    return (first.position ?? Number.MAX_SAFE_INTEGER) - (second.position ?? Number.MAX_SAFE_INTEGER);
}

/**
 * The row's place in `itemNames`, or null if it is not there. A json_each lookup would count every name it scans as a
 * row read, for every row; json_extract reads none. The path is built from the row's own name, which the path rule
 * keeps to letters, digits and underscores.
 */
function placeOf(itemNames: string[]): SQL {
    const places = JSON.stringify(Object.fromEntries(itemNames.map((name, index) => [name, index])));
    return sql`json_extract(${places}, '$."' || ${schema.item.itemName} || '"')`;
}

/**
 * The album, or null when there is no such row or `admin` is false and it is unpublished. The root is not a row, so
 * `self` is null for it.
 */
function assemble(children: Row[], self: Row[] | null, admin: boolean): AlbumGalleryItem | null {
    const visible = (row: Row): boolean => admin || row.item_type !== 'album' || row.published === 1;
    const shown = children.filter(visible).toSorted(inAlbumOrder).map(toRecord);
    if (self === null) {
        return { itemType: 'album', path: '/', parentPath: '', itemName: '', children: shown };
    }
    const row = self.find(visible);
    const order = children.some((child) => child.position !== null);
    return row?.item_type === 'album' ? { ...toAlbumRecord(row), ...(order && { order }), children: shown } : null;
}
