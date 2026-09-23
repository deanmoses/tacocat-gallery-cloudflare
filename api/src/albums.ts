import { eq } from 'drizzle-orm';
import {
    type Album,
    type Child,
    type ItemKey,
    type NavInfo,
    albumKey,
    albumPath,
    isAlbumPath,
    mediaPath,
} from 'tacocat-gallery-shared';
import * as valibot from 'valibot';
import { currentAdmin } from './auth';
import { type Orm, orm, schema } from './db';
import { d1Header } from './db/timing';
import { BOOKMARK_HEADER, json, notFound, pathAfter } from './http';

// A row of `item` as D1 returns it, under its SQL column names: run() is the query method that returns D1's meta, and
// its rows are untyped.
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
});
const ROWS = valibot.array(ROW);
type Row = valibot.InferOutput<typeof ROW>;

export interface Rows {
    rows: Row[];
    meta: D1Meta;
}

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
    const database = orm(session);
    const key = albumKey(path);
    const started = performance.now();
    // The parent's children hold the album's own row and the neighbours prev and next point at.
    const [children, family] = await Promise.all([
        childrenOf(database, path),
        key === null ? null : childrenOf(database, key.parentPath),
    ]);
    const d1Ms = performance.now() - started;
    const rowsRead = children.meta.rows_read + (family?.meta.rows_read ?? 0);
    const album = assemble(path, key, children.rows, family?.rows ?? null, admin);
    return album === null
        ? notFound()
        : json(album, 200, {
              [BOOKMARK_HEADER]: session.getBookmark() ?? '',
              'x-d1': d1Header(children.meta, d1Ms, rowsRead),
          });
}

function withTrailingSlash(path: string): string {
    return path.endsWith('/') ? path : `${path}/`;
}

/** Every item directly inside the album at `path`, in name order. */
export async function childrenOf(database: Orm, path: string): Promise<Rows> {
    const { item } = schema;
    const result = await database.select().from(item).where(eq(item.parentPath, path)).orderBy(item.itemName).run();
    return { rows: valibot.parse(ROWS, result.results), meta: result.meta };
}

/** The album, or null when there is no such row or `admin` is false and it is unpublished. The root is not a row. */
function assemble(
    path: string,
    key: ItemKey | null,
    children: Row[],
    family: Row[] | null,
    admin: boolean,
): Album | null {
    const visible = (row: Row): boolean => admin || row.item_type !== 'album' || row.published === 1;
    const shown = children.filter(visible).map(toChild);
    if (key === null || family === null) {
        return {
            path,
            title: null,
            description: null,
            published: true,
            updatedOn: null,
            prev: null,
            next: null,
            children: shown,
        };
    }
    const peers = family.filter(visible);
    const at = peers.findIndex((row) => row.item_name === key.itemName);
    const self = peers[at];
    if (self === undefined) {
        return null;
    }
    return {
        path,
        title: self.title,
        description: self.description,
        published: self.published === 1,
        updatedOn: self.updated_on,
        prev: toNav(peers[at - 1]),
        next: toNav(peers[at + 1]),
        children: shown,
    };
}

function toNav(row: Row | undefined): NavInfo | null {
    return row === undefined ? null : { path: albumPath(row.parent_path, row.item_name), title: row.title };
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
    };
}
