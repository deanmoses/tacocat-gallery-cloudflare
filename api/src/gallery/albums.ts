import { type SQL, and, asc, eq, exists, isNull, sql } from 'drizzle-orm';
import { type SQLiteUpdate, alias } from 'drizzle-orm/sqlite-core';
import { type AlbumGalleryItem, type ItemKey, albumKey } from 'tacocat-gallery-shared';
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
        .select({ id: item.id })
        .from(item)
        .where(and(eq(item.parentPath, media.parentPath), eq(item.itemName, media.itemName)));
    return database
        .update(item)
        .set({ thumbnailId: sql`(${mediaId})` })
        .$dynamic()
        .where(
            and(
                eq(item.parentPath, album.parentPath),
                eq(item.itemName, album.itemName),
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
