import { type SQL, and, asc, eq, exists, isNull, notExists, sql } from 'drizzle-orm';
import { type SQLiteUpdate, alias } from 'drizzle-orm/sqlite-core';
import * as valibot from 'valibot';
import { type AlbumGalleryItem, type AlbumWrite, type ItemKey, albumKey, albumPath } from 'tacocat-gallery-shared';
import { type Orm, schema } from '../db';
import { type Row, type Rows, selectRecords, toAlbumRecord, toRecord } from './records';

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
    const [children, self] = await Promise.all([
        rowsWhere(database, eq(item.parentPath, path)),
        key === null
            ? null
            : rowsWhere(database, and(eq(item.parentPath, key.parentPath), eq(item.itemName, key.itemName))),
    ]);
    const d1Ms = performance.now() - started;
    return {
        album: assemble(children.rows, self?.rows ?? null, admin),
        meta: children.meta,
        rowsRead: children.meta.rows_read + (self?.meta.rows_read ?? 0),
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

// Every write's conditions are in its statement, since D1's one atomic unit is a batch of statements fixed before any
// runs: the statement's changes say whether the rule held, and `describeAlbum` then says why it did not.

/** What a write did: how many rows it changed, and D1's account of it, which a batch does not give. */
export interface Written {
    changes: number;
    meta: D1Meta | null;
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

function written(result: D1Result): Written {
    return { changes: result.meta.changes, meta: result.meta };
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
    const cut = mediaPath.lastIndexOf('/');
    const media = { parentPath: mediaPath.slice(0, cut + 1), itemName: mediaPath.slice(cut + 1) };
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

function caption(text: string | null | undefined): string | null {
    return text === undefined || text === null || text.trim() === '' ? null : text;
}

function isKey(table: typeof schema.item | typeof ALBUM, key: ItemKey): SQL {
    return and(eq(table.parentPath, key.parentPath), eq(table.itemName, key.itemName)) ?? sql`1`;
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

/** The items matching `where`, in name order, each with its thumbnail's row beside it. */
async function rowsWhere(database: Orm, where: SQL | undefined): Promise<Rows> {
    return selectRecords(database, { where, orderBy: [asc(schema.item.itemName)] });
}

/**
 * The album, or null when there is no such row or `admin` is false and it is unpublished. The root is not a row, so
 * `self` is null for it.
 */
function assemble(children: Row[], self: Row[] | null, admin: boolean): AlbumGalleryItem | null {
    const visible = (row: Row): boolean => admin || row.item_type !== 'album' || row.published === 1;
    const shown = children.filter(visible).map(toRecord);
    if (self === null) {
        return { itemType: 'album', path: '/', parentPath: '', itemName: '', children: shown };
    }
    const row = self.find(visible);
    return row?.item_type === 'album' ? { ...toAlbumRecord(row), children: shown } : null;
}
