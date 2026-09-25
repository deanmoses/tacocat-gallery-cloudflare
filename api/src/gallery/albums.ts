import { type SQL, and, eq, exists, getTableColumns, isNull, sql } from 'drizzle-orm';
import { type SQLiteUpdate, alias } from 'drizzle-orm/sqlite-core';
import {
    type AlbumGalleryItem,
    type AlbumRecord,
    type AlbumThumbnailRecord,
    type GalleryRecord,
    type ItemKey,
    type MediaRecord,
    albumKey,
    albumPath,
    mediaPath,
    mediaTypeSchema,
    rectangleSchema,
} from 'tacocat-gallery-shared';
import * as valibot from 'valibot';
import { type Orm, schema } from '../db';

/** A JSON column as D1 returns it, text, parsed against `shape`. */
function jsonColumn<T extends valibot.GenericSchema>(shape: T): valibot.GenericSchema<string, valibot.InferOutput<T>> {
    return valibot.pipe(
        valibot.string(),
        valibot.transform((text): unknown => JSON.parse(text)),
        shape,
    );
}

const CROP = jsonColumn(rectangleSchema);
const TAGS = jsonColumn(valibot.array(valibot.string()));

// A row of `item` joined to its thumbnail's row, as D1 returns it under SQL column names: run() is the query method
// that returns D1's meta, and its rows are untyped.
const ROW_FIELDS = {
    parent_path: valibot.string(),
    item_name: valibot.string(),
    title: valibot.nullable(valibot.string()),
    description: valibot.nullable(valibot.string()),
    summary: valibot.nullable(valibot.string()),
    tags: valibot.nullable(TAGS),
    version_id: valibot.nullable(valibot.string()),
    published: valibot.number(),
    updated_at: valibot.string(),
    width: valibot.nullable(valibot.number()),
    height: valibot.nullable(valibot.number()),
    duration_seconds: valibot.nullable(valibot.number()),
    thumbnail_crop: valibot.nullable(CROP),
    thumb_parent_path: valibot.nullable(valibot.string()),
    thumb_item_name: valibot.nullable(valibot.string()),
    thumb_version_id: valibot.nullable(valibot.string()),
    thumb_crop: valibot.nullable(CROP),
};
const ROW = valibot.variant('item_type', [
    valibot.object({ item_type: valibot.literal('album'), media_type: valibot.null(), ...ROW_FIELDS }),
    valibot.object({ item_type: valibot.literal('media'), media_type: mediaTypeSchema, ...ROW_FIELDS }),
]);
const ROWS = valibot.array(ROW);
type Row = valibot.InferOutput<typeof ROW>;
type AlbumRow = Extract<Row, { item_type: 'album' }>;
type MediaRow = Extract<Row, { item_type: 'media' }>;

interface Rows {
    rows: Row[];
    meta: D1Meta;
}

export interface AlbumRead {
    album: AlbumGalleryItem | null;
    meta: D1Meta;
    rowsRead: number;
    d1Ms: number;
}

const THUMB = alias(schema.item, 'thumb');

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
    const { item } = schema;
    const result = await database
        .select({
            ...getTableColumns(item),
            thumb_parent_path: sql`${THUMB.parentPath}`.as('thumb_parent_path'),
            thumb_item_name: sql`${THUMB.itemName}`.as('thumb_item_name'),
            thumb_version_id: sql`${THUMB.versionId}`.as('thumb_version_id'),
            thumb_crop: sql`${THUMB.thumbnailCrop}`.as('thumb_crop'),
        })
        .from(item)
        .leftJoin(THUMB, eq(THUMB.id, item.thumbnailId))
        .where(where)
        .orderBy(item.itemName)
        .run();
    return { rows: valibot.parse(ROWS, result.results), meta: result.meta };
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

function toRecord(row: Row): GalleryRecord {
    return row.item_type === 'album' ? toAlbumRecord(row) : toMediaRecord(row);
}

function toAlbumRecord(row: AlbumRow): AlbumRecord {
    const thumbnail = toThumbnail(row);
    return {
        itemType: 'album',
        path: albumPath(row.parent_path, row.item_name),
        parentPath: row.parent_path,
        itemName: row.item_name,
        updatedOn: row.updated_at,
        ...(row.description !== null && { description: row.description }),
        published: row.published === 1,
        ...(thumbnail !== undefined && { thumbnail }),
        ...(row.summary !== null && { summary: row.summary }),
    };
}

function toMediaRecord(row: MediaRow): MediaRecord {
    const record = {
        itemType: 'media' as const,
        path: mediaPath(row.parent_path, row.item_name),
        parentPath: row.parent_path,
        itemName: row.item_name,
        updatedOn: row.updated_at,
        ...(row.description !== null && { description: row.description }),
        // A media item comes with its file and its size; rows from before that was required say nothing of either.
        versionId: row.version_id ?? '',
        dimensions: { width: row.width ?? 0, height: row.height ?? 0 },
        ...(row.thumbnail_crop !== null && { thumbnail: row.thumbnail_crop }),
        ...(row.title !== null && { title: row.title }),
        ...(row.tags !== null && { tags: row.tags }),
    };
    return row.media_type === 'video'
        ? { ...record, mediaType: 'video', duration: row.duration_seconds ?? 0 }
        : { ...record, mediaType: 'image' };
}

/** Undefined for an album with no thumbnail, or one whose media has no file yet. */
function toThumbnail(row: Row): AlbumThumbnailRecord | undefined {
    return row.thumb_parent_path === null || row.thumb_item_name === null || row.thumb_version_id === null
        ? undefined
        : {
              path: mediaPath(row.thumb_parent_path, row.thumb_item_name),
              versionId: row.thumb_version_id,
              ...(row.thumb_crop !== null && { crop: row.thumb_crop }),
          };
}
