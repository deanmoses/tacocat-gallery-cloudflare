import { type SQL, and, eq, notExists, sql } from 'drizzle-orm';
import { type AnySQLiteColumn, alias } from 'drizzle-orm/sqlite-core';
import type { CropPercent, ItemKey, MediaWrite } from 'tacocat-gallery-shared';
import * as valibot from 'valibot';
import { type Orm, schema } from '../db';
import { type Written, caption, isKey, written } from './writes';

const OTHER = alias(schema.item, 'other');

/** Changes what the admin wrote about the photo or video. */
export async function updateMedia(database: Orm, key: ItemKey, fields: MediaWrite): Promise<Written> {
    const { item } = schema;
    const result = await database
        .update(item)
        .set({
            ...('title' in fields && { title: caption(fields.title) }),
            ...('description' in fields && { description: caption(fields.description) }),
        })
        .where(and(isKey(item, key), eq(item.itemType, 'media')))
        .run();
    return written(result);
}

/**
 * Drops the row. The database clears it from any album it was the thumbnail of, and its objects wait for the purge,
 * so a photo deleted by mistake is restored by pointing a new row at its version.
 */
export async function deleteMedia(database: Orm, key: ItemKey): Promise<Written> {
    const { item } = schema;
    const result = await database
        .delete(item)
        .where(and(isKey(item, key), eq(item.itemType, 'media')))
        .run();
    return written(result);
}

/** Gives the row a new name, unless another item has it. Its objects are keyed by version, so nothing else moves. */
export async function renameMedia(database: Orm, key: ItemKey, newName: string): Promise<Written> {
    const { item } = schema;
    const taken = database
        .select({ id: OTHER.id })
        .from(OTHER)
        .where(isKey(OTHER, { parentPath: key.parentPath, itemName: newName }));
    const result = await database
        .update(item)
        .set({ itemName: newName })
        .where(and(isKey(item, key), eq(item.itemType, 'media'), notExists(taken)))
        .run();
    return written(result);
}

/**
 * Stores the rectangle the thumbnail is cut from, given in percent of the image, as pixels of the row's own width and
 * height, so no read comes first. Each edge is rounded on its own and the far edges are clamped to the image, so the
 * stored rectangle is at least a pixel wide and fits, whatever the rounding.
 */
export async function recutThumbnail(database: Orm, key: ItemKey, crop: CropPercent): Promise<Written> {
    const { item } = schema;
    const left = pixels(item.width, crop.x, 'left');
    const top = pixels(item.height, crop.y, 'left');
    const right = pixels(item.width, crop.x + crop.width, 'right');
    const bottom = pixels(item.height, crop.y + crop.height, 'right');
    const result = await database
        .update(item)
        .set({
            thumbnailCrop: sql`json_object('x', ${left}, 'y', ${top}, 'width', max(1, ${right} - ${left}), 'height', max(1, ${bottom} - ${top}))`,
        })
        .where(and(isKey(item, key), eq(item.itemType, 'media')))
        .run();
    return written(result);
}

/**
 * `percent` of `dimension` as a whole number of pixels: a left or top edge at most one pixel inside the far side, so
 * there is room for the rectangle, and a right or bottom edge at most the far side itself.
 */
function pixels(dimension: AnySQLiteColumn, percent: number, edge: 'left' | 'right'): SQL {
    const rounded = sql`CAST(round(${dimension} * ${percent} / 100.0) AS INTEGER)`;
    return edge === 'left' ? sql`min(${rounded}, ${dimension} - 1)` : sql`min(${rounded}, ${dimension})`;
}

/** What a write that changed nothing can be told: whether the media item is there, and whether `newName` is taken. */
export interface MediaFacts {
    exists: boolean;
    taken: boolean;
}

const FACTS = valibot.array(
    valibot.object({ found: valibot.nullable(valibot.number()), taken: valibot.nullable(valibot.number()) }),
);

/** One read that answers why a write to the media item at `key` changed nothing. */
export async function describeMedia(database: Orm, key: ItemKey, { newName = '' } = {}): Promise<MediaFacts> {
    const { item } = schema;
    const result = await database.run(
        sql`SELECT
            (${database
                .select({ id: item.id })
                .from(item)
                .where(and(isKey(item, key), eq(item.itemType, 'media')))}) AS found,
            (${database
                .select({ id: item.id })
                .from(item)
                .where(isKey(item, { parentPath: key.parentPath, itemName: newName }))}) AS taken`,
    );
    const [facts] = valibot.parse(FACTS, result.results);
    return {
        exists: facts?.found !== null && facts?.found !== undefined,
        taken: facts?.taken !== null && facts?.taken !== undefined,
    };
}
