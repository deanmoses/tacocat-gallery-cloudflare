import { type AlbumGalleryItem, parseAlbum } from 'tacocat-gallery-shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { call, callAsAdmin, callForJson, parseExactly, putItem } from '../helpers';

const YEAR = '/1981/';
const DAY = '/1981/01-01/';
const CROP = { x: 10, y: 20, width: 300, height: 300 };
const IMAGE = { itemType: 'media', mediaType: 'image', width: 4, height: 3 } as const;

async function setThumbnail(albumPath: string, mediaPath: string, asAdmin = true): Promise<Response> {
    return (asAdmin ? callAsAdmin : call)(`/api/album${albumPath}thumbnail`, {
        method: 'POST',
        body: JSON.stringify({ path: mediaPath }),
    });
}

async function album(path: string, asAdmin = false): Promise<AlbumGalleryItem> {
    return parseExactly(await (asAdmin ? callAsAdmin : call)(`/api/album${path}`), parseAlbum);
}

describe('an album', () => {
    beforeEach(async () => {
        await Promise.all([
            putItem({ parentPath: '/', itemName: '1981', itemType: 'album', published: true }),
            putItem({ parentPath: YEAR, itemName: '01-01', itemType: 'album', summary: 'New year', published: true }),
            putItem({ parentPath: YEAR, itemName: '02-02', itemType: 'album', published: false }),
            putItem({ parentPath: YEAR, itemName: '03-03', itemType: 'album', published: true }),
            putItem({
                parentPath: DAY,
                itemName: 'a.jpg',
                itemType: 'media',
                mediaType: 'image',
                title: 'Beach',
                tags: ['sand', 'sea'],
                versionId: 'v1',
                width: 40,
                height: 30,
                published: true,
                thumbnailCrop: CROP,
            }),
            putItem({
                parentPath: DAY,
                itemName: 'b.mov',
                itemType: 'media',
                mediaType: 'video',
                versionId: 'v2',
                width: 16,
                height: 9,
                durationSeconds: 9.5,
                published: false,
            }),
        ]);
        await setThumbnail(DAY, '/1981/01-01/a.jpg');
    });

    // The records the AWS API sent, which the web app parses unchanged: what a record has none of is left out.
    it('is the AWS API record with its media', async () => {
        const day = await album(DAY);

        expect(day).toStrictEqual({
            itemType: 'album',
            path: DAY,
            parentPath: YEAR,
            itemName: '01-01',
            updatedOn: expect.any(String),
            published: true,
            thumbnail: { path: '/1981/01-01/a.jpg', versionId: 'v1', crop: CROP },
            summary: 'New year',
            children: [
                {
                    itemType: 'media',
                    mediaType: 'image',
                    path: '/1981/01-01/a.jpg',
                    parentPath: DAY,
                    itemName: 'a.jpg',
                    updatedOn: expect.any(String),
                    versionId: 'v1',
                    dimensions: { width: 40, height: 30 },
                    thumbnail: CROP,
                    title: 'Beach',
                    tags: ['sand', 'sea'],
                },
                {
                    itemType: 'media',
                    mediaType: 'video',
                    path: '/1981/01-01/b.mov',
                    parentPath: DAY,
                    itemName: 'b.mov',
                    updatedOn: expect.any(String),
                    versionId: 'v2',
                    dimensions: { width: 16, height: 9 },
                    duration: 9.5,
                },
            ],
        });
    });

    it('hides unpublished albums from guests and shows them to admins', async () => {
        const [guest, admin] = await Promise.all([album(YEAR), album(YEAR, true)]);

        expect(guest.children?.map((child) => child.itemName)).toStrictEqual(['01-01', '03-03']);
        expect(admin.children?.map((child) => child.itemName)).toStrictEqual(['01-01', '02-02', '03-03']);
    });

    it('is not found for a guest while unpublished', async () => {
        const [guest, admin] = await Promise.all([call('/api/album/1981/02-02/'), album('/1981/02-02/', true)]);
        await guest.body?.cancel();

        expect(guest.status).toBe(404);
        expect(admin.published).toBe(false);
    });

    // So that a cached album stays valid when its siblings change: the web app finds prev and next in the parent.
    it('reads the same after a sibling is published', async () => {
        const before = await callForJson<unknown>(`/api/album${DAY}`);
        await putItem({ parentPath: YEAR, itemName: '02-02', itemType: 'album', published: true });
        const after = await callForJson<unknown>(`/api/album${DAY}`);

        expect(after).toStrictEqual(before);
    });

    it('synthesizes the root from the year albums, as the AWS API did', async () => {
        const root = await album('/');

        expect(root).toStrictEqual({
            itemType: 'album',
            path: '/',
            parentPath: '',
            itemName: '',
            children: [
                {
                    itemType: 'album',
                    path: YEAR,
                    parentPath: '/',
                    itemName: '1981',
                    updatedOn: expect.any(String),
                    published: true,
                },
            ],
        });
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

    it('logs where D1 answered, so browser runs can be matched to the D1 copy that served them', async () => {
        const info = vi.spyOn(console, 'info').mockReturnValue();
        const response = await call(`/api/album${DAY}`);
        await response.body?.cancel();
        const logged = info.mock.calls
            .map(([line]: unknown[]) => line)
            .find(
                (line) => typeof line === 'object' && line !== null && 'event' in line && line.event === 'album_read',
            );

        expect(logged).toMatchObject({ event: 'album_read', path: DAY, bookmark: false, rows: expect.any(Number) });
        expect(logged).toHaveProperty('d1Region');
        expect(logged).toHaveProperty('d1Colo');
        expect(logged).toHaveProperty('d1Primary');
        expect(logged).toHaveProperty('d1Ms');
    });

    it('leaves caching open to a read without a bookmark', async () => {
        const response = await call(`/api/album${DAY}`);
        await response.body?.cancel();

        expect(response.headers.get('cache-control')).toBeNull();
    });

    it.each([
        { name: 'an empty bookmark cookie', cookie: 'd1_bookmark=' },
        { name: 'a bookmark cookie D1 cannot read', cookie: 'd1_bookmark=nonsense' },
    ])('is served with $name as if it had none', async ({ cookie }) => {
        const response = await call(`/api/album${DAY}`, { headers: { cookie } });

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBeNull();
        expect((await parseExactly(response, parseAlbum)).path).toBe(DAY);
    });
});

describe('an album thumbnail', () => {
    beforeEach(async () => {
        await Promise.all([
            putItem({ parentPath: '/', itemName: '1982', itemType: 'album', published: true }),
            putItem({ parentPath: '/1982/', itemName: '05-05', itemType: 'album', published: true }),
            putItem({ ...IMAGE, parentPath: '/1982/05-05/', itemName: 'a.jpg', versionId: 'v1' }),
            putItem({ ...IMAGE, parentPath: '/1982/05-05/', itemName: 'b.jpg', versionId: 'v2' }),
        ]);
    });

    it('shows on the album and on its entry in the parent', async () => {
        const set = await setThumbnail('/1982/05-05/', '/1982/05-05/b.jpg');
        const [day, year] = await Promise.all([album('/1982/05-05/'), album('/1982/')]);
        const thumbnail = { path: '/1982/05-05/b.jpg', versionId: 'v2' };

        expect(set.status).toBe(204);
        expect(day.thumbnail).toStrictEqual(thumbnail);
        expect(year.children).toStrictEqual([expect.objectContaining({ path: '/1982/05-05/', thumbnail })]);
    });

    it('can be a photo from another album, such as a day shown on its year', async () => {
        const set = await setThumbnail('/1982/', '/1982/05-05/a.jpg');

        expect(set.status).toBe(204);
        expect((await album('/1982/')).thumbnail?.path).toBe('/1982/05-05/a.jpg');
    });

    it('hands back its bookmark as a header and as a cookie for the browser to read with', async () => {
        const set = await setThumbnail('/1982/05-05/', '/1982/05-05/b.jpg');
        const bookmark = set.headers.get('x-d1-bookmark') ?? '';

        expect(bookmark).toMatch(/^\S+$/v);
        expect(set.headers.get('set-cookie')).toBe(
            `d1_bookmark=${bookmark}; Max-Age=300; Path=/; HttpOnly; Secure; SameSite=Lax`,
        );
    });

    it('is read back with the bookmark cookie, in an answer no cache keeps', async () => {
        const set = await setThumbnail('/1982/05-05/', '/1982/05-05/b.jpg');
        const [cookie = ''] = (set.headers.get('set-cookie') ?? '').split(';', 1);
        const response = await call('/api/album/1982/05-05/', { headers: { cookie } });

        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect((await parseExactly(response, parseAlbum)).thumbnail?.path).toBe('/1982/05-05/b.jpg');
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
        expect((await album('/1982/05-05/')).thumbnail).toBeUndefined();
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
