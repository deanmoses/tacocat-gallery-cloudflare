import { sql } from 'drizzle-orm';
import { type SearchResult, albumPath, mediaPath, mediaTypeSchema } from 'tacocat-gallery-shared';
import * as valibot from 'valibot';
import type { Orm } from '../db';

// A search match as D1 returns it, under SQL column names.
const SEARCH_ROW_FIELDS = {
    parent_path: valibot.string(),
    item_name: valibot.string(),
    title: valibot.nullable(valibot.string()),
    snippet: valibot.nullable(valibot.string()),
};
const SEARCH_ROWS = valibot.array(
    valibot.variant('item_type', [
        valibot.object({ item_type: valibot.literal('album'), media_type: valibot.null(), ...SEARCH_ROW_FIELDS }),
        valibot.object({ item_type: valibot.literal('media'), media_type: mediaTypeSchema, ...SEARCH_ROW_FIELDS }),
    ]),
);

export interface Found {
    results: SearchResult[];
    meta: D1Meta;
}

/**
 * The best 50 items for an FTS5 query, each with a snippet of its description. Unless `admin`, only what the album
 * pages show a guest: published albums, and media whose album is published.
 */
export async function searchItems(database: Orm, query: string, admin: boolean): Promise<Found> {
    // FTS5 is outside Drizzle's model, so this is raw SQL with a bound parameter.
    const found = await database.run(
        sql`SELECT i.parent_path, i.item_name, i.item_type, i.media_type,
                CASE WHEN i.item_type = 'album' THEN i.summary ELSE i.title END AS title,
                snippet(item_fts, 2, '[', ']', '…', 8) AS snippet
            FROM item_fts JOIN item i ON i.id = item_fts.rowid
            ${admin ? sql`` : GUEST_VISIBLE_JOIN}
            WHERE item_fts MATCH ${query}
            ${admin ? sql`` : GUEST_VISIBLE_FILTER}
            ORDER BY rank LIMIT 50`,
    );
    const results = valibot.parse(SEARCH_ROWS, found.results).map((row): SearchResult => {
        const shared = { itemName: row.item_name, title: row.title, snippet: row.snippet };
        return row.item_type === 'album'
            ? { itemType: 'album', path: albumPath(row.parent_path, row.item_name), ...shared }
            : {
                  itemType: 'media',
                  mediaType: row.media_type,
                  path: mediaPath(row.parent_path, row.item_name),
                  ...shared,
              };
    });
    return { results, meta: found.meta };
}

// The album an item is in, found from its parent path: of '/2001/06-15/' without its trailing slash, rtrim() strips
// every character but '/' from the end, leaving the album's parent path '/2001/', and the rest is its name '06-15'.
// The key is computed from the matched item alone, so finding the album is a lookup on the (parent_path, item_name) index.
const PARENT = sql.raw(`rtrim(i.parent_path, '/')`);
const ALBUM_PARENT_PATH = sql`rtrim(${PARENT}, replace(${PARENT}, '/', ''))`;
const GUEST_VISIBLE_JOIN = sql`LEFT JOIN item album
    ON album.parent_path = ${ALBUM_PARENT_PATH} AND album.item_name = substr(${PARENT}, length(${ALBUM_PARENT_PATH}) + 1)`;
const GUEST_VISIBLE_FILTER = sql`AND CASE WHEN i.item_type = 'album' THEN i.published = 1 ELSE album.published = 1 END`;
