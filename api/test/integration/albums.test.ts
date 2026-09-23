import { type Album, parseAlbum } from 'tacocat-gallery-shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { call, callAsAdmin, putItem } from '../helpers';

const YEAR = '/1981/';
const DAY = '/1981/01-01/';

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
            }),
            putItem({ parentPath: DAY, itemName: 'b.mov', itemType: 'video', durationSeconds: 9.5, published: false }),
        ]);
    });

    it('is the shared type, with its media and the published albums either side of it', async () => {
        const day = await album(DAY);

        expect(day).toStrictEqual({
            path: DAY,
            title: 'New year',
            description: null,
            published: true,
            updatedOn: expect.any(String),
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

        expect(root).toMatchObject({ path: '/', published: true, updatedOn: null, prev: null, next: null });
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
