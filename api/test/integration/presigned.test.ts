import { env } from 'cloudflare:workers';
import { asc } from 'drizzle-orm';
import { parsePresigned } from 'tacocat-gallery-shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { orm, schema } from '../../src/db';
import { inboxKey } from '../../src/storage/keys';
import { call, callAsAdmin, parseExactly, putItem, storedItem } from '../helpers';

const DAY = '/2024/06-15/';
const IMAGE = { itemType: 'media', mediaType: 'image', versionId: 'v1', width: 4, height: 3 } as const;

async function presign(albumPath: string, body: unknown, asAdmin = true): Promise<Response> {
    return (asAdmin ? callAsAdmin : call)(`/api/presigned${albumPath}`, { method: 'POST', body: JSON.stringify(body) });
}

async function errorMessage(response: Response): Promise<string> {
    return (await response.json<{ errorMessage: string }>()).errorMessage;
}

describe('asking for upload URLs', () => {
    beforeEach(async () => {
        await putItem({ parentPath: '/', itemName: '2024', itemType: 'album' });
        await putItem({ parentPath: '/2024/', itemName: '06-15', itemType: 'album' });
        await putItem({ parentPath: DAY, itemName: 'existing.jpg', ...IMAGE });
        await putItem({ parentPath: DAY, itemName: 'twin.jpg', ...IMAGE });
        await putItem({ parentPath: DAY, itemName: 'twin.png', ...IMAGE });
    });

    it('needs an admin', async () => {
        const response = await presign(DAY, [{ path: `${DAY}new.jpg` }], false);
        await response.body?.cancel();

        expect(response.status).toBe(401);
    });

    it.each([
        {
            what: 'a year album',
            albumPath: '/2024/',
            body: [{ path: '/2024/new.jpg' }],
            message: 'Invalid day album path',
        },
        {
            what: 'an album that is not there',
            albumPath: '/2024/12-25/',
            body: [{ path: '/2024/12-25/new.jpg' }],
            message: 'Album does not exist',
        },
        { what: 'nothing to upload', albumPath: DAY, body: [], message: 'No media to upload' },
        { what: 'a body that is not a list', albumPath: DAY, body: { path: `${DAY}new.jpg` }, message: 'Invalid type' },
        {
            what: 'a path in another album',
            albumPath: DAY,
            body: [{ path: '/2024/06-16/new.jpg' }],
            message: 'not in album',
        },
        {
            what: 'a file type the gallery does not take',
            albumPath: DAY,
            body: [{ path: `${DAY}notes.txt` }],
            message: 'Invalid media path',
        },
        {
            what: 'a name with no extension',
            albumPath: DAY,
            body: [{ path: `${DAY}felix` }],
            message: 'Invalid media path',
        },
        {
            what: 'the same path twice',
            albumPath: DAY,
            body: [{ path: `${DAY}new.jpg` }, { path: `${DAY}new.jpg` }],
            message: 'Duplicate media path',
        },
        {
            what: 'a name an item already has',
            albumPath: DAY,
            body: [{ path: `${DAY}existing.jpg` }],
            message: 'already exists',
        },
        {
            what: 'a replacement of nothing',
            albumPath: DAY,
            body: [{ path: `${DAY}nothing.jpg`, replaces: `${DAY}nothing.jpg` }],
            message: 'Media not found',
        },
        {
            what: 'a replacement in another album',
            albumPath: DAY,
            body: [{ path: `${DAY}new.jpg`, replaces: '/2024/06-16/new.jpg' }],
            message: 'not in album',
        },
        {
            what: 'a replacement under another name',
            albumPath: DAY,
            body: [{ path: `${DAY}renamed.jpg`, replaces: `${DAY}existing.jpg` }],
            message: 'must keep the name',
        },
        {
            what: 'a replacement whose new name another item holds',
            albumPath: DAY,
            body: [{ path: `${DAY}twin.png`, replaces: `${DAY}twin.jpg` }],
            message: 'already exists',
        },
    ])('refuses $what, issuing nothing', async ({ albumPath, body, message }) => {
        const response = await presign(albumPath, body);
        const rows = await orm(env.DB).select().from(schema.upload).all();

        expect(response.status).toBe(400);
        await expect(errorMessage(response)).resolves.toContain(message);
        expect(rows).toStrictEqual([]);
    });

    it('issues a URL and a fresh version id per path, and records what each upload is for and who asked', async () => {
        const response = await presign(DAY, [
            { path: `${DAY}new.jpg` },
            { path: `${DAY}existing.png`, replaces: `${DAY}existing.jpg` },
        ]);
        const uploads = await parseExactly(response, parsePresigned);
        const [day, existing] = await Promise.all([storedItem('/2024/', '06-15'), storedItem(DAY, 'existing.jpg')]);
        const rows = await orm(env.DB).select().from(schema.upload).orderBy(asc(schema.upload.itemName)).all();
        const newUpload = uploads[`${DAY}new.jpg`];
        const replacement = uploads[`${DAY}existing.png`];

        const signed = [newUpload, replacement].map((upload) => new URL(upload?.url ?? ''));

        expect(response.status).toBe(200);
        expect(Object.keys(uploads)).toStrictEqual([`${DAY}new.jpg`, `${DAY}existing.png`]);
        expect(signed.map((url) => url.pathname)).toStrictEqual(
            [newUpload, replacement].map((upload) => `/${env.MEDIA_BUCKET}/${inboxKey(upload?.versionId ?? '')}`),
        );
        expect(signed.map((url) => url.searchParams.get('X-Amz-Signature'))).toStrictEqual([
            expect.stringMatching(/^[\da-f]{64}$/v),
            expect.stringMatching(/^[\da-f]{64}$/v),
        ]);
        // The browser sends the file's own content type, which is not part of what was signed.
        expect(signed.map((url) => url.searchParams.get('X-Amz-SignedHeaders'))).toStrictEqual(['host', 'host']);
        expect(newUpload?.versionId).not.toBe(replacement?.versionId);
        expect(rows).toStrictEqual([
            expect.objectContaining({
                versionId: replacement?.versionId,
                parentPath: DAY,
                itemName: 'existing.png',
                albumId: day?.id,
                targetId: existing?.id,
                targetPath: `${DAY}existing.jpg`,
                username: 'moses',
                completedAt: null,
            }),
            expect.objectContaining({
                versionId: newUpload?.versionId,
                parentPath: DAY,
                itemName: 'new.jpg',
                albumId: day?.id,
                targetId: null,
                targetPath: null,
                username: 'moses',
                completedAt: null,
            }),
        ]);
    });

    it('takes a replacement in the same format under the same path', async () => {
        const response = await presign(DAY, [{ path: `${DAY}existing.jpg`, replaces: `${DAY}existing.jpg` }]);
        const uploads = await parseExactly(response, parsePresigned);

        expect(Object.keys(uploads)).toStrictEqual([`${DAY}existing.jpg`]);
    });
});
