import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { orm, upsertItem } from '../../src/db';
import { readAlbum } from '../../src/gallery/albums';

// A reader far from D1's primary pays a round trip per request sent to it, so a read is held to one.

/** Counts what D1 is asked: each statement run on its own and each batch. */
function requestsToD1(): () => number {
    const statement: unknown = Object.getPrototypeOf(env.DB.prepare('SELECT 1'));
    const database: unknown = Object.getPrototypeOf(env.DB);
    const spies = [
        vi.spyOn(statement as D1PreparedStatement, 'run'),
        vi.spyOn(statement as D1PreparedStatement, 'all'),
        vi.spyOn(statement as D1PreparedStatement, 'first'),
        vi.spyOn(statement as D1PreparedStatement, 'raw'),
        vi.spyOn(database as D1Database, 'batch'),
    ];
    return () => spies.reduce((count, spy) => count + spy.mock.calls.length, 0);
}

describe(readAlbum, () => {
    it.each(['/2001/', '/2001/06-15/'])('reads %s in one request to D1', async (path) => {
        const database = orm(env.DB);
        await database.batch([
            upsertItem(database, { parentPath: '/', itemName: '2001', itemType: 'album', published: true }),
            upsertItem(database, { parentPath: '/2001/', itemName: '06-15', itemType: 'album', published: true }),
            upsertItem(database, {
                parentPath: '/2001/06-15/',
                itemName: 'felix.jpg',
                itemType: 'media',
                mediaType: 'image',
                versionId: 'v1',
                width: 4,
                height: 3,
            }),
        ]);
        const requests = requestsToD1();

        const read = await readAlbum(database, path, false);

        expect(read.album?.children).toHaveLength(1);
        expect(requests()).toBe(1);
    });
});
