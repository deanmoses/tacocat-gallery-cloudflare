import { type Album, parseAlbum } from 'tacocat-gallery-shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { call, callAsAdmin, putItem } from '../helpers';

const YEAR = '/1981/';
const DAY = '/1981/01-01/';
const CROP = { x: 10, y: 20, width: 300, height: 300 };

async function setThumbnail(albumPath: string, mediaPath: string, asAdmin = true): Promise<Response> {
    return (asAdmin ? callAsAdmin : call)(`/api/album${albumPath}thumbnail`, {
        method: 'POST',
        body: JSON.stringify({ path: mediaPath }),
    });
}

async function album(path: string, asAdmin = false): Promise<Album> {
    const response = await (asAdmin ? callAsAdmin : call)(`/api/album${path}`);
    return parseAlbum(await response.json());
}

describe('an album', () => {
    beforeEach(async () => {
        await Promise.all([
            putItem({ parentPath: '/', itemName: '1981', itemType: 'album', published: true }),
            putItem({ parentPath: YEAR, itemName: '01-01', itemType: 'album', title: 'New year', published: true }),
            putItem({ parentPath: YEAR, itemName: '02-02', itemType: 'album', published: false }),
            putItem({ parentPath: YEAR, itemName: '03-03', itemType: 'album', published: true }),
            putItem({
                parentPath: DAY,
                itemName: 'a.jpg',
                itemType: 'image',
                title: 'Beach',
                versionId: 'v1',
                width: 40,
                height: 30,
                published: true,
                thumbnailCrop: CROP,
            }),
            putItem({ parentPath: DAY, itemName: 'b.mov', itemType: 'video', durationSeconds: 9.5, published: false }),
        ]);
        await setThumbnail(DAY, '/1981/01-01/a.jpg');
    });

    it('is the shared type, with its media and the published albums either side of it', async () => {
        const day = await album(DAY);

        expect(day).toStrictEqual({
            path: DAY,
            title: 'New year',
            description: null,
            published: true,
            updatedOn: expect.any(String),
            thumbnail: { path: '/1981/01-01/a.jpg', versionId: 'v1', crop: CROP },
            prev: null,
            next: { path: '/1981/03-03/', title: null },
            children: [
                {
                    itemType: 'image',
                    path: '/1981/01-01/a.jpg',
                    itemName: 'a.jpg',
                    title: 'Beach',
                    description: null,
                    updatedOn: expect.any(String),
                    tags: null,
                    versionId: 'v1',
                    width: 40,
                    height: 30,
                    durationSeconds: null,
                    thumbnailCrop: CROP,
                },
                {
                    itemType: 'video',
                    path: '/1981/01-01/b.mov',
                    itemName: 'b.mov',
                    title: null,
                    description: null,
                    updatedOn: expect.any(String),
                    tags: null,
                    versionId: null,
                    width: null,
                    height: null,
                    durationSeconds: 9.5,
                    thumbnailCrop: null,
                },
            ],
        });
    });

    it('hides unpublished albums from guests and shows them to admins', async () => {
        const [guest, admin] = await Promise.all([album(YEAR), album(YEAR, true)]);

        expect(guest.children.map((child) => child.itemName)).toStrictEqual(['01-01', '03-03']);
        expect(admin.children.map((child) => child.itemName)).toStrictEqual(['01-01', '02-02', '03-03']);
    });

    it('is not found for a guest while unpublished', async () => {
        const [guest, admin] = await Promise.all([call('/api/album/1981/02-02/'), album('/1981/02-02/', true)]);
        await guest.body?.cancel();

        expect(guest.status).toBe(404);
        expect(admin.published).toBe(false);
    });

    it('lets an admin step to an unpublished neighbour', async () => {
        const day = await album(DAY, true);

        expect(day.next).toStrictEqual({ path: '/1981/02-02/', title: null });
    });

    it('synthesizes the root from the year albums', async () => {
        const root = await album('/');

        expect(root).toMatchObject({
            path: '/',
            published: true,
            updatedOn: null,
            thumbnail: null,
            prev: null,
            next: null,
        });
        expect(root.children).toContainEqual(
            expect.objectContaining({ itemType: 'album', path: YEAR, itemName: '1981', published: true }),
        );
    });

    it('accepts its path without the trailing slash', async () => {
        const year = await album('/1981');

        expect(year.path).toBe(YEAR);
    });

    it.each(['/api/album/nope/', '/api/album/1981/12-25/', '/api/album/1981/01-01/a.jpg'])(
        'is not found at %s',
        async (path) => {
            const response = await call(path);
            await response.body?.cancel();

            expect(response.status).toBe(404);
        },
    );

    it('hands back a bookmark and says where D1 answered and how many rows it read', async () => {
        const response = await call(`/api/album${DAY}`);
        await response.body?.cancel();

        expect(response.headers.get('x-d1-bookmark')).not.toBe('');
        expect(response.headers.get('x-d1')).toMatch(/^rows=\d+ region=/v);
    });
});

describe('an album thumbnail', () => {
    beforeEach(async () => {
        await Promise.all([
            putItem({ parentPath: '/', itemName: '1982', itemType: 'album', published: true }),
            putItem({ parentPath: '/1982/', itemName: '05-05', itemType: 'album', published: true }),
            putItem({ parentPath: '/1982/05-05/', itemName: 'a.jpg', itemType: 'image', versionId: 'v1' }),
            putItem({ parentPath: '/1982/05-05/', itemName: 'b.jpg', itemType: 'image', versionId: 'v2' }),
        ]);
    });

    it('shows on the album and on its entry in the parent', async () => {
        const set = await setThumbnail('/1982/05-05/', '/1982/05-05/b.jpg');
        const [day, year] = await Promise.all([album('/1982/05-05/'), album('/1982/')]);
        const thumbnail = { path: '/1982/05-05/b.jpg', versionId: 'v2', crop: null };

        expect(set.status).toBe(200);
        expect(parseAlbum(await set.json()).thumbnail).toStrictEqual(thumbnail);
        expect(day.thumbnail).toStrictEqual(thumbnail);
        expect(year.children).toStrictEqual([expect.objectContaining({ path: '/1982/05-05/', thumbnail })]);
    });

    it('can be a photo from another album, such as a day shown on its year', async () => {
        const set = await setThumbnail('/1982/', '/1982/05-05/a.jpg');

        expect(set.status).toBe(200);
        expect((await album('/1982/')).thumbnail?.path).toBe('/1982/05-05/a.jpg');
    });

    it('needs an admin', async () => {
        const response = await setThumbnail('/1982/05-05/', '/1982/05-05/a.jpg', false);
        await response.body?.cancel();

        expect(response.status).toBe(401);
    });

    it.each([
        { what: 'a media item that does not exist', albumPath: '/1982/05-05/', mediaPath: '/1982/05-05/nope.jpg' },
        { what: 'an album that does not exist', albumPath: '/1982/06-06/', mediaPath: '/1982/05-05/a.jpg' },
    ])('is not found for $what, and changes nothing', async ({ albumPath, mediaPath }) => {
        const response = await setThumbnail(albumPath, mediaPath);
        await response.body?.cancel();

        expect(response.status).toBe(404);
        expect((await album('/1982/05-05/')).thumbnail).toBeNull();
    });

    it.each([
        { what: 'the root album', albumPath: '/', mediaPath: '/1982/05-05/a.jpg' },
        { what: 'an album path as the media', albumPath: '/1982/05-05/', mediaPath: '/1982/05-05/' },
    ])('is refused for $what', async ({ albumPath, mediaPath }) => {
        const response = await setThumbnail(albumPath, mediaPath);
        await response.body?.cancel();

        expect(response.status).toBe(400);
    });
});
