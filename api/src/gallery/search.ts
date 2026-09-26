import { type SQL, and, asc, desc, exists, gte, inArray, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { GalleryRecord } from 'tacocat-gallery-shared';
import * as valibot from 'valibot';
import { type Orm, batchRun, schema } from '../db';
import { recordsQuery, toRecord, toRows } from './records';

/** A search as the web app asks for one: words, a span of years, a direction and a page. */
export interface SearchQuery {
    terms: string;
    oldestYear?: number;
    newestYear?: number;
    oldestFirst: boolean;
    startAt: number;
    pageSize: number;
}

export interface Found {
    total: number;
    items: GalleryRecord[];
    /** The count's and the page's, in that order. */
    meta: D1Meta[];
}

const ALBUM = alias(schema.item, 'album');

/**
 * The items whose name, captions or tags hold every word of `terms`, in gallery-path order, newest first unless
 * `oldestFirst`, within the years asked for, one page of them and how many there are in all. Unless `admin`, only
 * what the album pages show a guest: published albums, and media whose album is published.
 */
export async function searchItems(database: Orm, query: SearchQuery, admin: boolean): Promise<Found> {
    const { item } = schema;
    const where = and(
        // FTS5 is outside Drizzle's model, so the match is raw SQL with a bound parameter.
        inArray(item.id, sql`(SELECT rowid FROM item_fts WHERE item_fts MATCH ${ftsQuery(query.terms)})`),
        ...(query.oldestYear === undefined ? [] : [gte(YEAR, String(query.oldestYear).padStart(4, '0'))]),
        ...(query.newestYear === undefined ? [] : [lte(YEAR, String(query.newestYear).padStart(4, '0'))]),
        ...(admin ? [] : [visibleToGuest(database)]),
    );
    const order = query.oldestFirst ? asc : desc;
    // Named in SQL, since the rows come back under their SQL names.
    const counted = database
        .select({ total: sql`count(*)`.as('total') })
        .from(item)
        .where(where);
    const paged = recordsQuery(database, {
        where,
        orderBy: [order(GALLERY_PATH)],
        limit: query.pageSize,
        offset: query.startAt,
    });
    // One batch, so the total and the page are counted from the same state.
    const [count, page] = await batchRun(database, [counted, paged]);
    if (count === undefined || page === undefined) {
        throw new Error('D1 answered fewer statements than the search sent');
    }
    return {
        total: valibot.parse(COUNTED, count.results)[0]?.total ?? 0,
        items: toRows(page).rows.map(toRecord),
        meta: [count.meta, page.meta],
    };
}

const COUNTED = valibot.array(valibot.object({ total: valibot.number() }));

/**
 * The words of `terms` as an FTS5 query, each quoted, so that no input is a syntax error and every word must match.
 * A double quote inside a word is doubled, which is how FTS5 escapes one.
 */
export function ftsQuery(terms: string): string {
    return terms
        .split(/\s+/v)
        .filter((word) => word !== '')
        .map((word) => `"${word.replaceAll('"', '""')}"`)
        .join(' ');
}

// The gallery path, which is chronological: an album sorts before what is in it, and a day before the next.
const GALLERY_PATH = sql`${schema.item.parentPath} || ${schema.item.itemName}`;

// The year an item belongs to, which is its parent path's first segment, or its own name for a year album.
const YEAR = sql`CASE WHEN ${schema.item.parentPath} = '/' THEN ${schema.item.itemName} ELSE substr(${schema.item.parentPath}, 2, 4) END`;

// The album an item is in, found from its parent path: of '/2001/06-15/' without its trailing slash, rtrim() strips
// every character but '/' from the end, leaving the album's parent path '/2001/', and the rest is its name '06-15'.
// The key is computed from the matched item alone, so finding the album is a lookup on the (parent_path, item_name) index.
const PARENT = sql`rtrim(${schema.item.parentPath}, '/')`;
const ALBUM_PARENT_PATH = sql`rtrim(${PARENT}, replace(${PARENT}, '/', ''))`;

/** A published album, or media whose album is published. */
function visibleToGuest(database: Orm): SQL {
    const { item } = schema;
    const albumPublished = exists(
        database
            .select({ id: ALBUM.id })
            .from(ALBUM)
            .where(
                and(
                    sql`${ALBUM.parentPath} = ${ALBUM_PARENT_PATH}`,
                    sql`${ALBUM.itemName} = substr(${PARENT}, length(${ALBUM_PARENT_PATH}) + 1)`,
                    sql`${ALBUM.published} = 1`,
                ),
            ),
    );
    return sql`CASE WHEN ${item.itemType} = 'album' THEN ${item.published} = 1 ELSE ${albumPublished} END`;
}
