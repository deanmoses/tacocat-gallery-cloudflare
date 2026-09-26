import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { orm, upsertItem } from '../../src/db';
import { readAlbum } from '../../src/gallery/albums';
import { presignUploads } from '../../src/gallery/presign';
import { searchItems } from '../../src/gallery/search';
import { TEST_SECRETS } from '../secrets';

// A read that sends D1 two requests can have them answered by different instances, or a write land between them, so
// what belongs together goes in one.

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

describe(searchItems, () => {
    it('counts and reads a page in one request to D1', async () => {
        const database = orm(env.DB);
        await database.batch([
            upsertItem(database, { parentPath: '/', itemName: '2001', itemType: 'album', published: true }),
            upsertItem(database, { parentPath: '/2001/', itemName: '06-15', itemType: 'album', published: true }),
            upsertItem(database, {
                parentPath: '/2001/06-15/',
                itemName: 'felix.jpg',
                itemType: 'media',
                mediaType: 'image',
                title: 'Felix',
                versionId: 'v1',
                width: 4,
                height: 3,
            }),
        ]);
        const requests = requestsToD1();

        const found = await searchItems(
            database,
            { query: { index: 'stemmed', match: 'felix' }, oldestFirst: false, startAt: 0, pageSize: 10 },
            false,
        );

        expect(found.total).toBe(1);
        expect(found.items).toHaveLength(1);
        expect(requests()).toBe(1);
    });
});

describe(presignUploads, () => {
    it('reads the album and its children in one request to D1, then writes the uploads in one', async () => {
        const database = orm(env.DB);
        await database.batch([
            upsertItem(database, { parentPath: '/', itemName: '2001', itemType: 'album', published: true }),
            upsertItem(database, { parentPath: '/2001/', itemName: '06-15', itemType: 'album', published: true }),
        ]);
        const requests = requestsToD1();

        const result = await presignUploads(
            { ...TEST_SECRETS, MEDIA_BUCKET: 'test-media', UPLOADS: 'signed' },
            database,
            '/2001/06-15/',
            [{ path: '/2001/06-15/new.jpg' }],
            'moses',
        );

        expect('uploads' in result && Object.keys(result.uploads)).toHaveLength(1);
        expect(requests()).toBe(2);
    });
});
