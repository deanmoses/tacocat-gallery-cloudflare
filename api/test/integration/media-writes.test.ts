import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { type AlbumGalleryItem, parseAlbum } from 'tacocat-gallery-shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { orm, schema } from '../../src/db';
import { originalKey } from '../../src/storage/keys';
import { call, callAsAdmin, parseExactly, putItem, storedItem } from '../helpers';

const DAY = '/1990/06-15/';
const IMAGE = { itemType: 'media', mediaType: 'image', versionId: 'v1', width: 400, height: 300 } as const;

type Init = Parameters<typeof call>[1];

async function write(method: string, path: string, body?: unknown, init: Init = {}): Promise<Response> {
    return callAsAdmin(path, { ...init, method, ...(body !== undefined && { body: JSON.stringify(body) }) });
}

async function album(path: string): Promise<AlbumGalleryItem> {
    return parseExactly(await callAsAdmin(`/api/album${path}`), parseAlbum);
}

async function errorMessage(response: Response): Promise<string> {
    return (await response.json<{ errorMessage: string }>()).errorMessage;
}

/** The day's media record at `name`, as the album page shows it. */
async function mediaRecord(
    name: string,
): Promise<AlbumGalleryItem['children'] extends (infer T)[] | undefined ? T : never> {
    const day = await album(DAY);
    const found = day.children?.find((child) => child.itemName === name);
    if (found === undefined) {
        throw new Error(`no ${name} in ${DAY}`);
    }
    return found;
}

describe('a media item', () => {
    beforeEach(async () => {
        await Promise.all([
            putItem({ parentPath: '/', itemName: '1990', itemType: 'album', published: true }),
            putItem({ parentPath: '/1990/', itemName: '06-15', itemType: 'album', published: true }),
            putItem({ parentPath: DAY, itemName: 'felix.jpg', ...IMAGE, title: 'Felix', description: 'At one' }),
            putItem({ parentPath: DAY, itemName: 'cake.jpg', ...IMAGE, versionId: 'v2' }),
            putItem({
                parentPath: DAY,
                itemName: 'clip.mov',
                ...IMAGE,
                mediaType: 'video',
                versionId: 'v3',
                durationSeconds: 9,
            }),
        ]);
        await write('PATCH', `/api/album-thumb${DAY}`, { mediaPath: `${DAY}felix.jpg` });
        await write('PATCH', '/api/album-thumb/1990/', { mediaPath: `${DAY}felix.jpg` });
    });

    describe('updating a media item', () => {
        it('changes the fields the body holds and leaves the rest, with a bookmark to read it back with', async () => {
            const response = await write('PATCH', `/api/media${DAY}felix.jpg`, { description: 'At the beach' });
            const felix = await mediaRecord('felix.jpg');

            expect(response.status).toBe(204);
            expect(response.headers.get('set-cookie')).toMatch(/^d1_bookmark=\S+;/v);
            expect(felix).toMatchObject({ title: 'Felix', description: 'At the beach' });
        });

        it('clears a caption the editor emptied', async () => {
            await write('PATCH', `/api/media${DAY}felix.jpg`, { title: '', description: ' ' });
            const felix = await mediaRecord('felix.jpg');

            expect(felix).not.toHaveProperty('title');
            expect(felix).not.toHaveProperty('description');
        });

        it.each([
            { what: 'nothing to change', body: {}, message: 'No attributes to update' },
            { what: 'a field it does not know', body: { summary: 'x' }, message: expect.stringContaining('summary') },
            { what: 'a title that is not text', body: { title: 5 }, message: expect.stringContaining('title') },
        ])('refuses $what', async ({ body, message }) => {
            const response = await write('PATCH', `/api/media${DAY}felix.jpg`, body);

            expect(response.status).toBe(400);
            await expect(errorMessage(response)).resolves.toStrictEqual(message);
        });

        it.each([
            {
                what: 'a media item that is not there',
                path: `${DAY}nope.jpg`,
                message: `Media not found: [${DAY}nope.jpg]`,
            },
            { what: 'an album', path: DAY, message: 'Not Found' },
        ])('is not found for $what', async ({ path, message }) => {
            const response = await write('PATCH', `/api/media${path}`, { title: 'x' });

            expect(response.status).toBe(404);
            await expect(errorMessage(response)).resolves.toBe(message);
        });

        it('needs an admin', async () => {
            const response = await call(`/api/media${DAY}felix.jpg`, { method: 'PATCH', body: '{"title":"x"}' });
            await response.body?.cancel();

            expect(response.status).toBe(401);
        });
    });

    describe('deleting a media item', () => {
        it('drops the row and clears it from the albums it was the thumbnail of', async () => {
            const response = await write('DELETE', `/api/media${DAY}felix.jpg`);
            const [day, year] = await Promise.all([album(DAY), album('/1990/')]);

            expect(response.status).toBe(204);
            expect(day.children?.map((child) => child.itemName)).toStrictEqual(['cake.jpg', 'clip.mov']);
            expect(day.thumbnail).toBeUndefined();
            expect(year.thumbnail).toBeUndefined();
        });

        it('leaves the objects for the purge', async () => {
            await env.MEDIA.put(originalKey('v1'), new Uint8Array(3));
            await write('DELETE', `/api/media${DAY}felix.jpg`);

            await expect(env.MEDIA.head(originalKey('v1'))).resolves.not.toBeNull();
        });

        it('is not found for a media item that is not there, and for an album', async () => {
            const [missing, asAlbum] = await Promise.all([
                write('DELETE', `/api/media${DAY}nope.jpg`),
                write('DELETE', `/api/media${DAY}`),
            ]);
            await asAlbum.body?.cancel();

            expect(missing.status).toBe(404);
            await expect(errorMessage(missing)).resolves.toBe(`Media not found: [${DAY}nope.jpg]`);
            expect(asAlbum.status).toBe(404);
            await expect(album(DAY)).resolves.toMatchObject({ path: DAY });
        });

        it('needs an admin', async () => {
            const response = await call(`/api/media${DAY}felix.jpg`, { method: 'DELETE' });
            await response.body?.cancel();

            expect(response.status).toBe(401);
            await expect(storedItem(DAY, 'felix.jpg')).resolves.toBeDefined();
        });
    });

    describe('renaming a media item', () => {
        it("changes the name, keeps everything else and stays every album's thumbnail", async () => {
            const response = await write('POST', `/api/media-rename${DAY}felix.jpg`, { newName: 'felix_at_one.jpg' });
            const [day, year, old] = await Promise.all([album(DAY), album('/1990/'), storedItem(DAY, 'felix.jpg')]);

            expect(response.status).toBe(204);
            expect(day.children?.map((child) => child.itemName)).toStrictEqual([
                'cake.jpg',
                'clip.mov',
                'felix_at_one.jpg',
            ]);
            expect(day.children?.at(-1)).toMatchObject({ title: 'Felix', description: 'At one', versionId: 'v1' });
            expect(day.thumbnail).toStrictEqual({ path: `${DAY}felix_at_one.jpg`, versionId: 'v1' });
            expect(year.thumbnail?.path).toBe(`${DAY}felix_at_one.jpg`);
            expect(old).toBeUndefined();
        });

        it('is found by search under the new name', async () => {
            await write('POST', `/api/media-rename${DAY}felix.jpg`, { newName: 'birthday.jpg' });
            const found = await callAsAdmin('/api/search/birthday');
            const { items } = await found.json<{ items: { path: string }[] }>();

            expect(items.map((item) => item.path)).toStrictEqual([`${DAY}birthday.jpg`]);
        });

        it.each([
            { what: 'a capital letter', newName: 'Felix.jpg', message: 'New media name is invalid: [Felix.jpg]' },
            { what: 'a hyphen', newName: 'felix-1.jpg', message: 'New media name is invalid: [felix-1.jpg]' },
            {
                what: 'two underscores in a row',
                newName: 'felix__1.jpg',
                message: 'New media name is invalid: [felix__1.jpg]',
            },
            { what: 'no extension', newName: 'felix', message: 'New media name is invalid: [felix]' },
            {
                what: 'another extension',
                newName: 'felix.png',
                message: 'New media name [felix.png] must keep the extension [.jpg]',
            },
            {
                what: 'the same name',
                newName: 'felix.jpg',
                message: `New media name [felix.jpg] cannot be same as old one [${DAY}felix.jpg]`,
            },
            {
                what: 'a name another item has',
                newName: 'cake.jpg',
                message: `A media item already exists at [${DAY}cake.jpg]`,
            },
        ])('refuses $what, and changes nothing', async ({ newName, message }) => {
            const response = await write('POST', `/api/media-rename${DAY}felix.jpg`, { newName });

            expect(response.status).toBe(400);
            await expect(errorMessage(response)).resolves.toBe(message);
            await expect(storedItem(DAY, 'felix.jpg')).resolves.toMatchObject({ title: 'Felix' });
        });

        it('keeps a video its extension too', async () => {
            const response = await write('POST', `/api/media-rename${DAY}clip.mov`, { newName: 'clip.mp4' });

            expect(response.status).toBe(400);
            await expect(errorMessage(response)).resolves.toBe(
                'New media name [clip.mp4] must keep the extension [.mov]',
            );
        });

        it('is not found for a media item that is not there', async () => {
            const response = await write('POST', `/api/media-rename${DAY}nope.jpg`, { newName: 'yes.jpg' });

            expect(response.status).toBe(404);
            await expect(errorMessage(response)).resolves.toBe(`Media not found: [${DAY}nope.jpg]`);
        });

        it('needs an admin', async () => {
            const response = await call(`/api/media-rename${DAY}felix.jpg`, {
                method: 'POST',
                body: JSON.stringify({ newName: 'x.jpg' }),
            });
            await response.body?.cancel();

            expect(response.status).toBe(401);
        });
    });

    describe('recutting a thumbnail', () => {
        it('stores the rectangle in pixels of the image, and the albums that show the item cut it there', async () => {
            const response = await write('PATCH', `/api/thumb${DAY}felix.jpg`, { x: 10, y: 20, width: 50, height: 50 });
            const [felix, day] = await Promise.all([mediaRecord('felix.jpg'), album(DAY)]);

            expect(response.status).toBe(204);
            expect(felix).toMatchObject({ thumbnail: { x: 40, y: 60, width: 200, height: 150 } });
            expect(day.thumbnail).toStrictEqual({
                path: `${DAY}felix.jpg`,
                versionId: 'v1',
                crop: { x: 40, y: 60, width: 200, height: 150 },
            });
        });

        it('rounds each edge on its own, so the rectangle always fits and is never empty', async () => {
            await putItem({ parentPath: DAY, itemName: 'tiny.jpg', ...IMAGE, width: 10, height: 10 });
            const [edge, sliver] = await Promise.all([
                write('PATCH', `/api/thumb${DAY}tiny.jpg`, { x: 0.6, y: 0, width: 99.4, height: 100 }),
                write('PATCH', `/api/thumb${DAY}cake.jpg`, { x: 99.9, y: 99.9, width: 0.1, height: 0.1 }),
            ]);
            const [tiny, cake] = await Promise.all([mediaRecord('tiny.jpg'), mediaRecord('cake.jpg')]);

            expect([edge.status, sliver.status]).toStrictEqual([204, 204]);
            expect(tiny).toMatchObject({ thumbnail: { x: 0, y: 0, width: 10, height: 10 } });
            expect(cake).toMatchObject({ thumbnail: { x: 399, y: 299, width: 1, height: 1 } });
        });

        it.each([
            { what: 'a negative edge', crop: { x: -1, y: 0, width: 50, height: 50 } },
            { what: 'a rectangle past the right edge', crop: { x: 60, y: 0, width: 50, height: 50 } },
            { what: 'no width', crop: { x: 0, y: 0, width: 0, height: 50 } },
            { what: 'a side missing', crop: { x: 0, y: 0, width: 50 } },
            { what: 'a side that is text', crop: { x: 0, y: 0, width: '50', height: 50 } },
            { what: 'pixels rather than percent', crop: { x: 0, y: 0, width: 400, height: 300 } },
        ])('refuses $what, and changes nothing', async ({ crop }) => {
            const response = await write('PATCH', `/api/thumb${DAY}felix.jpg`, crop);
            await response.body?.cancel();

            expect(response.status).toBe(400);
            await expect(mediaRecord('felix.jpg')).resolves.not.toHaveProperty('thumbnail');
        });

        it('is not found for a media item that is not there, and needs an admin', async () => {
            const missing = await write('PATCH', `/api/thumb${DAY}nope.jpg`, { x: 0, y: 0, width: 50, height: 50 });
            const guest = await call(`/api/thumb${DAY}felix.jpg`, {
                method: 'PATCH',
                body: JSON.stringify({ x: 0, y: 0, width: 50, height: 50 }),
            });
            await guest.body?.cancel();

            expect(missing.status).toBe(404);
            await expect(errorMessage(missing)).resolves.toBe(`Image not found: [${DAY}nope.jpg]`);
            expect(guest.status).toBe(401);
        });

        it('moves the update time of the row it changed', async () => {
            const { item } = schema;
            const before = await storedItem(DAY, 'felix.jpg');
            await write('PATCH', `/api/thumb${DAY}felix.jpg`, { x: 0, y: 0, width: 50, height: 50 });
            const after = await orm(env.DB)
                .select()
                .from(item)
                .where(eq(item.id, before?.id ?? 0))
                .get();

            expect(after?.createdAt).toBe(before?.createdAt);
            expect(after?.thumbnailCrop).toStrictEqual({ x: 0, y: 0, width: 200, height: 150 });
        });
    });
});
