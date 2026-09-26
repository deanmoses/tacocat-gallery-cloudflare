import { type SQL, eq, getTableColumns, sql } from 'drizzle-orm';
import { type SQLiteSelect, alias } from 'drizzle-orm/sqlite-core';
import {
    type AlbumRecord,
    type AlbumThumbnailRecord,
    type GalleryRecord,
    type MediaRecord,
    albumPath,
    mediaPath,
    mediaTypeSchema,
    rectangleSchema,
} from 'tacocat-gallery-shared';
import * as valibot from 'valibot';
import { type Orm, schema } from '../db';

// An item's row joined to its thumbnail's, as the album and search reads select it, and the API record made from it.

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

// As D1 returns the row under SQL column names: run() is the query method that returns D1's meta, and its rows are
// untyped.
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

export type Row = valibot.InferOutput<typeof ROW>;
export type AlbumRow = Extract<Row, { item_type: 'album' }>;
type MediaRow = Extract<Row, { item_type: 'media' }>;

const THUMB = alias(schema.item, 'thumb');

/** What to select: the rows matching `where`, in `orderBy` order, `limit` of them from `offset`. */
export interface Selection {
    where: SQL | undefined;
    orderBy: SQL[];
    limit?: number;
    offset?: number;
}

export interface Rows {
    rows: Row[];
    meta: D1Meta;
}

/** The items of a selection, each with its thumbnail's row beside it, checked before anything reads them. */
export async function selectRecords(database: Orm, selection: Selection): Promise<Rows> {
    const result = await recordsQuery(database, selection).run();
    return { rows: valibot.parse(ROWS, result.results), meta: result.meta };
}

/**
 * The items of each selection, read in one request to D1. Drizzle's own batch maps each result to rows and drops
 * D1's meta, which the response header and the rows-read budget need, so the statements go to the client directly.
 */
export async function selectRecordsBatch(database: Orm, selections: Selection[]): Promise<Rows[]> {
    const statements = selections.map((selection) => {
        const { sql: text, params } = recordsQuery(database, selection).toSQL();
        return database.$client.prepare(text).bind(...params);
    });
    const results = await database.$client.batch(statements);
    return results.map((result) => ({ rows: valibot.parse(ROWS, result.results), meta: result.meta }));
}

function recordsQuery(database: Orm, selection: Selection): SQLiteSelect<'item', 'async', D1Result> {
    const { item } = schema;
    const query = database
        .select({
            ...getTableColumns(item),
            thumb_parent_path: sql`${THUMB.parentPath}`.as('thumb_parent_path'),
            thumb_item_name: sql`${THUMB.itemName}`.as('thumb_item_name'),
            thumb_version_id: sql`${THUMB.versionId}`.as('thumb_version_id'),
            thumb_crop: sql`${THUMB.thumbnailCrop}`.as('thumb_crop'),
        })
        .from(item)
        .leftJoin(THUMB, eq(THUMB.id, item.thumbnailId))
        .$dynamic()
        .where(selection.where)
        .orderBy(...selection.orderBy);
    return selection.limit === undefined ? query : query.limit(selection.limit).offset(selection.offset ?? 0);
}

export function toRecord(row: Row): GalleryRecord {
    return row.item_type === 'album' ? toAlbumRecord(row) : toMediaRecord(row);
}

export function toAlbumRecord(row: AlbumRow): AlbumRecord {
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
