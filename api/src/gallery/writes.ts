import { type SQL, and, eq } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { ItemKey } from 'tacocat-gallery-shared';

// What every gallery write shares. Each write's conditions are in its statement, since D1's one atomic unit is a batch
// of statements fixed before any runs: the statement's changes say whether the rule held, and a read afterwards says
// why it did not.

/** What a write did: how many rows it changed, and D1's account of it, which a batch does not give. */
export interface Written {
    changes: number;
    meta: D1Meta | null;
}

export function written(result: D1Result): Written {
    return { changes: result.meta.changes, meta: result.meta };
}

/** A caption as the column keeps it: one that is blank once trimmed clears the field. */
export function caption(text: string | null | undefined): string | null {
    return text === undefined || text === null || text.trim() === '' ? null : text;
}

/** The row at `key`, in the item table or an alias of it. */
export function isKey(table: { parentPath: AnySQLiteColumn; itemName: AnySQLiteColumn }, key: ItemKey): SQL {
    return (
        and(eq(table.parentPath, key.parentPath), eq(table.itemName, key.itemName)) ?? eq(table.itemName, key.itemName)
    );
}
