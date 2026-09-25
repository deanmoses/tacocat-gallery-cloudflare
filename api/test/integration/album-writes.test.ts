import { env } from 'cloudflare:workers';
import { asc, eq } from 'drizzle-orm';
import { type AlbumGalleryItem, parseAlbum } from 'tacocat-gallery-shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { orm, schema } from '../../src/db';
import { call, callAsAdmin, parseExactly, putItem, storedItem } from '../helpers';

const IMAGE = { itemType: 'media', mediaType: 'image', versionId: 'v1', width: 4, height: 3 } as const;

type Init = Parameters<typeof call>[1];

/** Sends an admin write as the web app does, with a JSON body unless there is none. */
async function write(method: string, path: string, body?: unknown, init: Init = {}): Promise<Response> {
    return callAsAdmin(path, { ...init, method, ...(body !== undefined && { body: JSON.stringify(body) }) });
}

async function album(path: string, asAdmin = true): Promise<AlbumGalleryItem> {
    return parseExactly(await (asAdmin ? callAsAdmin : call)(`/api/album${path}`), parseAlbum);
}

async function errorMessage(response: Response): Promise<string> {
    return (await response.json<{ errorMessage: string }>()).errorMessage;
}

describe('creating an album', () => {
    beforeEach(async () => {
        await putItem({ parentPath: '/', itemName: '1990', itemType: 'album', published: true });
    });

    it.each([
        { what: 'a year', path: '/1991/', key: { parentPath: '/', itemName: '1991' } },
        { what: 'a day', path: '/1990/06-15/', key: { parentPath: '/1990/', itemName: '06-15' } },
    ])('makes $what, unpublished, with a bookmark to read it back with', async ({ path, key }) => {
        const response = await write('PUT', `/api/album${path}`, {});
        const row = await storedItem(key.parentPath, key.itemName);

        expect(response.status).toBe(204);
        expect(response.headers.get('set-cookie')).toMatch(/^d1_bookmark=\S+;/v);
        expect(row).toMatchObject({ ...key, itemType: 'album', published: false, summary: null, description: null });
    });

    it('takes the fields the body holds, and no body at all', async () => {
        const withFields = await write('PUT', '/api/album/1990/06-15/', {
            summary: 'Felix turns one',
            description: '<p>At the beach</p>',
            published: true,
        });
        const withoutBody = await write('PUT', '/api/album/1990/06-16/');
        const [day, other] = await Promise.all([album('/1990/06-15/'), album('/1990/06-16/')]);

        expect([withFields.status, withoutBody.status]).toStrictEqual([204, 204]);
        expect(day).toMatchObject({ summary: 'Felix turns one', description: '<p>At the beach</p>', published: true });
        expect(other.published).toBe(false);
    });

    it('refuses an album that is there already, and leaves it as it was', async () => {
        await write('PUT', '/api/album/1990/06-15/', { summary: 'First' });
        const response = await write('PUT', '/api/album/1990/06-15/', { summary: 'Second' });

        expect(response.status).toBe(400);
        await expect(errorMessage(response)).resolves.toBe('Album already exists: [/1990/06-15/]');
        expect((await album('/1990/06-15/')).summary).toBe('First');
    });

    it.each([
        { what: 'the root', path: '/', status: 400 },
        { what: 'a media path', path: '/1990/06-15/a.jpg', status: 404 },
        { what: 'a word', path: '/tacos/', status: 404 },
    ])('refuses $what', async ({ path, status }) => {
        const response = await write('PUT', `/api/album${path}`, {});
        await response.body?.cancel();

        expect(response.status).toBe(status);
    });

    it.each([
        { what: 'a field it does not know', body: { title: 'Felix' } },
        { what: 'a published flag that is not a boolean', body: { published: 'yes' } },
        { what: 'a body that is not JSON', body: 'not json' },
    ])('refuses $what', async ({ body }) => {
        const response = await callAsAdmin('/api/album/1990/06-15/', {
            method: 'PUT',
            body: typeof body === 'string' ? body : JSON.stringify(body),
        });
        await response.body?.cancel();

        expect(response.status).toBe(400);
        await expect(storedItem('/1990/', '06-15')).resolves.toBeUndefined();
    });

    it('needs an admin', async () => {
        const response = await call('/api/album/1990/06-15/', { method: 'PUT', body: '{}' });
        await response.body?.cancel();

        expect(response.status).toBe(401);
    });
});

describe('updating an album', () => {
    beforeEach(async () => {
        await Promise.all([
            putItem({ parentPath: '/', itemName: '1990', itemType: 'album', published: true }),
            putItem({ parentPath: '/', itemName: '1991', itemType: 'album', published: false }),
            putItem({ parentPath: '/1990/', itemName: '06-15', itemType: 'album', summary: 'Kept', published: false }),
            putItem({ parentPath: '/1991/', itemName: '06-15', itemType: 'album', published: false }),
        ]);
    });

    it('changes the fields the body holds and leaves the rest', async () => {
        const response = await write('PATCH', '/api/album/1990/06-15/', { description: '<p>Beach</p>' });
        const day = await album('/1990/06-15/');

        expect(response.status).toBe(204);
        expect(day).toMatchObject({ summary: 'Kept', description: '<p>Beach</p>', published: false });
    });

    it('clears a caption the editor emptied', async () => {
        await write('PATCH', '/api/album/1990/06-15/', { summary: '  ' });
        const day = await album('/1990/06-15/');

        expect(day.summary).toBeUndefined();
    });

    it('publishes a day under a published year, and a year', async () => {
        const [day, year] = await Promise.all([
            write('PATCH', '/api/album/1990/06-15/', { published: true }),
            write('PATCH', '/api/album/1991/', { published: true }),
        ]);

        expect([day.status, year.status]).toStrictEqual([204, 204]);
        expect((await album('/1990/06-15/', false)).published).toBe(true);
        expect((await album('/1991/', false)).published).toBe(true);
    });

    it('refuses to publish a day under an unpublished year, and leaves it as it was', async () => {
        const response = await write('PATCH', '/api/album/1991/06-15/', { published: true, summary: 'Changed' });
        const day = await album('/1991/06-15/');

        expect(response.status).toBe(400);
        await expect(errorMessage(response)).resolves.toBe('Cannot publish until parent is published');
        expect(day).toMatchObject({ published: false });
        expect(day.summary).toBeUndefined();
    });

    it('unpublishes a day whatever its year is', async () => {
        await write('PATCH', '/api/album/1990/06-15/', { published: true });
        await write('PATCH', '/api/album/1990/', { published: false });
        const response = await write('PATCH', '/api/album/1990/06-15/', { published: false });

        expect(response.status).toBe(204);
    });

    it('is not found for an album that is not there', async () => {
        const response = await write('PATCH', '/api/album/1990/07-04/', { summary: 'Nope' });

        expect(response.status).toBe(404);
        await expect(errorMessage(response)).resolves.toBe('Album not found: [/1990/07-04/]');
    });

    it.each([
        { what: 'nothing to change', body: {}, message: 'No attributes to update' },
        { what: 'a field it does not know', body: { title: 'x' }, message: expect.stringContaining('title') },
    ])('refuses $what', async ({ body, message }) => {
        const response = await write('PATCH', '/api/album/1990/06-15/', body);

        expect(response.status).toBe(400);
        await expect(errorMessage(response)).resolves.toStrictEqual(message);
    });

    it('cannot change the root', async () => {
        const response = await write('PATCH', '/api/album/', { published: true });

        expect(response.status).toBe(400);
        await expect(errorMessage(response)).resolves.toBe('Cannot update the root album');
    });
});

describe('deleting an album', () => {
    beforeEach(async () => {
        await Promise.all([
            putItem({ parentPath: '/', itemName: '1990', itemType: 'album', published: true }),
            putItem({ parentPath: '/1990/', itemName: '06-15', itemType: 'album', published: true }),
            putItem({ parentPath: '/1990/', itemName: '06-16', itemType: 'album', published: true }),
            putItem({ parentPath: '/1990/06-15/', itemName: 'a.jpg', ...IMAGE }),
        ]);
    });

    it('removes an empty album', async () => {
        const response = await write('DELETE', '/api/album/1990/06-16/');
        const gone = await call('/api/album/1990/06-16/');
        await gone.body?.cancel();

        expect(response.status).toBe(204);
        expect(gone.status).toBe(404);
    });

    it.each([
        { what: 'photos', path: '/1990/06-15/' },
        { what: 'albums', path: '/1990/' },
    ])('refuses an album with $what in it, and leaves it', async ({ path }) => {
        const response = await write('DELETE', `/api/album${path}`);

        expect(response.status).toBe(400);
        await expect(errorMessage(response)).resolves.toBe(
            `Album [${path}] contains child photos or child albums, and thus cannot be deleted.`,
        );
        await expect(album(path)).resolves.toMatchObject({ path });
    });

    it('is not found for an album that is not there', async () => {
        const response = await write('DELETE', '/api/album/1990/07-04/');

        expect(response.status).toBe(404);
        await expect(errorMessage(response)).resolves.toBe('Album not found: [/1990/07-04/]');
    });

    it('cannot delete the root, and needs an admin', async () => {
        const root = await write('DELETE', '/api/album/');
        const guest = await call('/api/album/1990/06-16/', { method: 'DELETE' });
        await guest.body?.cancel();

        expect(root.status).toBe(400);
        await expect(errorMessage(root)).resolves.toBe('Cannot delete the root album');
        expect(guest.status).toBe(401);
    });
});

describe('renaming a day album', () => {
    beforeEach(async () => {
        await Promise.all([
            putItem({ parentPath: '/', itemName: '1990', itemType: 'album', published: true }),
            putItem({ parentPath: '/1990/', itemName: '06-15', itemType: 'album', summary: 'Picnic', published: true }),
            putItem({ parentPath: '/1990/', itemName: '06-16', itemType: 'album', published: true }),
            putItem({ parentPath: '/1990/06-15/', itemName: 'a.jpg', ...IMAGE, title: 'First' }),
            putItem({ parentPath: '/1990/06-15/', itemName: 'b.jpg', ...IMAGE, versionId: 'v2' }),
        ]);
        await write('PATCH', '/api/album-thumb/1990/06-15/', { mediaPath: '/1990/06-15/b.jpg' });
        await write('PATCH', '/api/album-thumb/1990/', { mediaPath: '/1990/06-15/a.jpg' });
    });

    it('moves the album and everything in it, keeping every thumbnail, in one batch', async () => {
        const response = await write('POST', '/api/album-rename/1990/06-15/', { newName: '07-04' });
        const [cookie = ''] = (response.headers.get('set-cookie') ?? '').split(';', 1);
        const [renamed, year, old] = await Promise.all([
            parseExactly(await callAsAdmin('/api/album/1990/07-04/', { headers: { cookie } }), parseAlbum),
            album('/1990/'),
            call('/api/album/1990/06-15/'),
        ]);
        await old.body?.cancel();

        expect(response.status).toBe(204);
        expect(renamed).toMatchObject({
            path: '/1990/07-04/',
            summary: 'Picnic',
            thumbnail: { path: '/1990/07-04/b.jpg', versionId: 'v2' },
        });
        expect(renamed.children?.map((child) => child.path)).toStrictEqual(['/1990/07-04/a.jpg', '/1990/07-04/b.jpg']);
        expect(year.thumbnail).toStrictEqual({ path: '/1990/07-04/a.jpg', versionId: 'v1' });
        expect(year.children?.map((child) => child.path)).toStrictEqual(['/1990/06-16/', '/1990/07-04/']);
        expect(old.status).toBe(404);
    });

    it('keeps the photos findable by search under the new path', async () => {
        await write('POST', '/api/album-rename/1990/06-15/', { newName: '07-04' });
        const found = await callAsAdmin('/api/search/first');
        const { items } = await found.json<{ items: { path: string }[] }>();

        expect(items.map((item) => item.path)).toStrictEqual(['/1990/07-04/a.jpg']);
    });

    it('refuses a name another album has, and moves nothing', async () => {
        const response = await write('POST', '/api/album-rename/1990/06-15/', { newName: '06-16' });
        const { item } = schema;
        const rows = await orm(env.DB)
            .select({ parentPath: item.parentPath, itemName: item.itemName })
            .from(item)
            .where(eq(item.parentPath, '/1990/06-15/'))
            .orderBy(asc(item.itemName));

        expect(response.status).toBe(400);
        await expect(errorMessage(response)).resolves.toBe('Album already exists [/1990/06-16/]');
        expect(rows).toHaveLength(2);
        await expect(album('/1990/06-16/')).resolves.toMatchObject({ children: [] });
    });

    it('is not found for an album that is not there', async () => {
        const response = await write('POST', '/api/album-rename/1990/07-04/', { newName: '07-05' });

        expect(response.status).toBe(404);
        await expect(errorMessage(response)).resolves.toBe('Album not found [/1990/07-04/]');
    });

    it.each([
        { what: 'a year', path: '/1990/', newName: '1991', message: 'Cannot rename year albums' },
        { what: 'the root', path: '/', newName: '1991', message: 'Cannot rename the root album' },
        {
            what: 'a name that is no day',
            path: '/1990/06-15/',
            newName: 'picnic',
            message: 'New name for album is invalid: [picnic]',
        },
        {
            what: 'the same name',
            path: '/1990/06-15/',
            newName: '06-15',
            message: 'New album [/1990/06-15/] cannot be same as old [/1990/06-15/]',
        },
    ])('refuses $what', async ({ path, newName, message }) => {
        const response = await write('POST', `/api/album-rename${path}`, { newName });

        expect(response.status).toBe(400);
        await expect(errorMessage(response)).resolves.toBe(message);
    });

    it('needs an admin', async () => {
        const response = await call('/api/album-rename/1990/06-15/', {
            method: 'POST',
            body: JSON.stringify({ newName: '07-04' }),
        });
        await response.body?.cancel();

        expect(response.status).toBe(401);
    });
});
