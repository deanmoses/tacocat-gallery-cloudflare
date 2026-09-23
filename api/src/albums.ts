import { type SQL, and, eq, exists, getTableColumns, isNull, sql } from 'drizzle-orm';
import { type SQLiteUpdate, alias } from 'drizzle-orm/sqlite-core';
import {
    type Album,
    type Child,
    type ItemKey,
    type Thumbnail,
    albumKey,
    albumPath,
    isAlbumPath,
    mediaKey,
    mediaPath,
    rectangleSchema,
    setThumbnailSchema,
} from 'tacocat-gallery-shared';
import * as valibot from 'valibot';
import { currentAdmin } from './auth';
import { NOW, type Orm, orm, schema } from './db';
import { d1Header } from './db/timing';
import { BOOKMARK_HEADER, json, notFound, pathAfter } from './http';

// A crop as the column stores it, JSON text.
const CROP = valibot.pipe(
    valibot.string(),
    valibot.transform((text): unknown => JSON.parse(text)),
    rectangleSchema,
);

// A row of `item` joined to its thumbnail's row, as D1 returns it under SQL column names: run() is the query method
// that returns D1's meta, and its rows are untyped.
const ROW = valibot.object({
    parent_path: valibot.string(),
    item_name: valibot.string(),
    item_type: valibot.picklist(['album', 'image', 'video']),
    title: valibot.nullable(valibot.string()),
    description: valibot.nullable(valibot.string()),
    tags: valibot.nullable(valibot.string()),
    version_id: valibot.nullable(valibot.string()),
    published: valibot.number(),
    updated_on: valibot.string(),
    width: valibot.nullable(valibot.number()),
    height: valibot.nullable(valibot.number()),
    duration_seconds: valibot.nullable(valibot.number()),
    thumbnail_crop: valibot.nullable(CROP),
    thumb_parent_path: valibot.nullable(valibot.string()),
    thumb_item_name: valibot.nullable(valibot.string()),
    thumb_version_id: valibot.nullable(valibot.string()),
    thumb_crop: valibot.nullable(CROP),
});
const ROWS = valibot.array(ROW);
type Row = valibot.InferOutput<typeof ROW>;

interface Rows {
    rows: Row[];
    meta: D1Meta;
}

interface AlbumRead {
    album: Album | null;
    meta: D1Meta;
    rowsRead: number;
    d1Ms: number;
}

const THUMB = alias(schema.item, 'thumb');

/**
 * Reads through the Sessions API so a nearby replica can answer. A client that just wrote passes the bookmark it got
 * back, which guarantees it reads its own write; ?consistency=primary forces the primary. Guests see published albums
 * only; media shows whenever its album does, since publishing is decided per album.
 */
export async function getAlbum(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = withTrailingSlash(`/${pathAfter(url, '/api/album/')}`);
    if (!isAlbumPath(path)) {
        return notFound();
    }
    const admin = (await currentAdmin(request, env)) !== null;
    const constraint =
        request.headers.get(BOOKMARK_HEADER) ??
        (url.searchParams.get('consistency') === 'primary' ? 'first-primary' : 'first-unconstrained');
    const session = env.DB.withSession(constraint);
    const read = await readAlbum(orm(session), path, admin);
    return read.album === null
        ? notFound()
        : json(read.album, 200, {
              [BOOKMARK_HEADER]: session.getBookmark() ?? '',
              'x-d1': d1Header(read.meta, read.d1Ms, read.rowsRead),
          });
}

/**
 * `POST /api/album/<path>/thumbnail` with `{ path }` of a media item makes that the album's thumbnail, and answers
 * with the album as the admin now sees it.
 */
export async function setAlbumThumbnail(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = `/${pathAfter(url, '/api/album/').slice(0, -'thumbnail'.length)}`;
    if (!isAlbumPath(path)) {
        return notFound();
    }
    const album = albumKey(path);
    if (album === null) {
        return json({ error: 'the root album has no thumbnail' }, 400);
    }
    const body = valibot.safeParse(setThumbnailSchema, await request.json());
    const media = body.success ? mediaKey(body.output.path) : null;
    if (media === null) {
        return json({ error: 'expected { path } of a media item, such as /2001/06-15/felix.jpg' }, 400);
    }
    const session = env.DB.withSession('first-primary');
    const database = orm(session);
    const set = await setThumbnail(database, album, media).run();
    if (set.meta.changes === 0) {
        return notFound({ album: path, media: mediaPath(media.parentPath, media.itemName) });
    }
    const read = await readAlbum(database, path, true);
    return json(read.album, 200, {
        [BOOKMARK_HEADER]: session.getBookmark() ?? '',
        'x-d1': d1Header(read.meta, read.d1Ms, set.meta.rows_read + read.rowsRead),
    });
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
        .set({ thumbnailId: sql`(${mediaId})`, updatedOn: NOW })
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

function withTrailingSlash(path: string): string {
    return path.endsWith('/') ? path : `${path}/`;
}

/**
 * The album at `path` with its children, as `admin` or a guest sees it. Nothing in it comes from outside the album's
 * own subtree, so a sibling changing leaves it as it was; the web app finds prev and next in the parent's children.
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
        album: assemble(path, children.rows, self?.rows ?? null, admin),
        meta: children.meta,
        rowsRead: children.meta.rows_read + (self?.meta.rows_read ?? 0),
        d1Ms,
    };
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
function assemble(path: string, children: Row[], self: Row[] | null, admin: boolean): Album | null {
    const visible = (row: Row): boolean => admin || row.item_type !== 'album' || row.published === 1;
    const shown = children.filter(visible).map(toChild);
    if (self === null) {
        return {
            path,
            title: null,
            description: null,
            published: true,
            updatedOn: null,
            thumbnail: null,
            children: shown,
        };
    }
    const row = self.find(visible);
    if (row === undefined) {
        return null;
    }
    return {
        path,
        title: row.title,
        description: row.description,
        published: row.published === 1,
        updatedOn: row.updated_on,
        thumbnail: toThumbnail(row),
        children: shown,
    };
}

function toThumbnail(row: Row): Thumbnail | null {
    return row.thumb_parent_path === null || row.thumb_item_name === null
        ? null
        : {
              path: mediaPath(row.thumb_parent_path, row.thumb_item_name),
              versionId: row.thumb_version_id,
              crop: row.thumb_crop,
          };
}

function toChild(row: Row): Child {
    const shared = {
        itemName: row.item_name,
        title: row.title,
        description: row.description,
        updatedOn: row.updated_on,
    };
    if (row.item_type === 'album') {
        return {
            itemType: 'album',
            path: albumPath(row.parent_path, row.item_name),
            ...shared,
            published: row.published === 1,
            thumbnail: toThumbnail(row),
        };
    }
    return {
        itemType: row.item_type,
        path: mediaPath(row.parent_path, row.item_name),
        ...shared,
        tags: row.tags,
        versionId: row.version_id,
        width: row.width,
        height: row.height,
        durationSeconds: row.duration_seconds,
        thumbnailCrop: row.thumbnail_crop,
    };
}
