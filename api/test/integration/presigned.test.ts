import { env } from 'cloudflare:workers';
import { asc } from 'drizzle-orm';
import { parsePresigned } from '@tacocat-gallery/shared';
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
        await putItem({ parentPath: DAY, itemName: 'existing', ...IMAGE });
    });

    it('needs an admin', async () => {
        const response = await presign(DAY, [{ path: `${DAY}new` }], false);
        await response.body?.cancel();

        expect(response.status).toBe(401);
    });

    it.each([
        {
            what: 'a year album',
            albumPath: '/2024/',
            body: [{ path: '/2024/new' }],
            message: 'Invalid day album path',
        },
        {
            what: 'an album that is not there',
            albumPath: '/2024/12-25/',
            body: [{ path: '/2024/12-25/new' }],
            message: 'Album does not exist',
        },
        { what: 'nothing to upload', albumPath: DAY, body: [], message: 'No media to upload' },
        { what: 'a body that is not a list', albumPath: DAY, body: { path: `${DAY}new` }, message: 'Invalid type' },
        {
            what: 'a path in another album',
            albumPath: DAY,
            body: [{ path: '/2024/06-16/new' }],
            message: 'not in album',
        },
        {
            what: 'a name with an extension',
            albumPath: DAY,
            body: [{ path: `${DAY}felix.jpg` }],
            message: 'Invalid media path',
        },
        {
            what: 'a name the sanitizer would have lowercased',
            albumPath: DAY,
            body: [{ path: `${DAY}IMG_0001` }],
            message: 'Invalid media path',
        },
        {
            what: 'a name with a hyphen',
            albumPath: DAY,
            body: [{ path: `${DAY}my-photo` }],
            message: 'Invalid media path',
        },
        {
            what: 'the same path twice',
            albumPath: DAY,
            body: [{ path: `${DAY}new` }, { path: `${DAY}new` }],
            message: 'Duplicate media path',
        },
        {
            what: 'a name an item already has',
            albumPath: DAY,
            body: [{ path: `${DAY}existing` }],
            message: 'already exists',
        },
        {
            what: 'a replacement of nothing',
            albumPath: DAY,
            body: [{ path: `${DAY}nothing`, replace: true }],
            message: 'Media not found',
        },
        {
            what: 'a replacement in another album',
            albumPath: DAY,
            body: [{ path: '/2024/06-16/new', replace: true }],
            message: 'not in album',
        },
        {
            what: 'a replacement that says so with something other than a boolean',
            albumPath: DAY,
            body: [{ path: `${DAY}existing`, replace: 'yes' }],
            message: 'Invalid type',
        },
    ])('refuses $what, issuing nothing', async ({ albumPath, body, message }) => {
        const response = await presign(albumPath, body);
        const rows = await orm(env.DB).select().from(schema.upload).all();

        expect(response.status).toBe(400);
        await expect(errorMessage(response)).resolves.toContain(message);
        expect(rows).toStrictEqual([]);
    });

    it('issues a URL and a fresh version id per path, and records what each upload is for and who asked', async () => {
        const response = await presign(DAY, [{ path: `${DAY}new` }, { path: `${DAY}existing`, replace: true }]);
        const uploads = await parseExactly(response, parsePresigned);
        const [day, existing] = await Promise.all([storedItem('/2024/', '06-15'), storedItem(DAY, 'existing')]);
        const rows = await orm(env.DB).select().from(schema.upload).orderBy(asc(schema.upload.itemName)).all();
        const newUpload = uploads[`${DAY}new`];
        const replacement = uploads[`${DAY}existing`];

        const signed = [newUpload, replacement].map((upload) => new URL(upload?.url ?? ''));

        expect(response.status).toBe(200);
        expect(Object.keys(uploads)).toStrictEqual([`${DAY}new`, `${DAY}existing`]);
        expect(signed.map((url) => url.pathname)).toStrictEqual(
            [newUpload, replacement].map((upload) => `/${env.UPLOADS_BUCKET}/${inboxKey(upload?.versionId ?? '')}`),
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
                itemName: 'existing',
                albumId: day?.id,
                replacement: true,
                targetId: existing?.id,
                username: 'moses',
                completedAt: null,
            }),
            expect.objectContaining({
                versionId: newUpload?.versionId,
                parentPath: DAY,
                itemName: 'new',
                albumId: day?.id,
                replacement: false,
                targetId: null,
                username: 'moses',
                completedAt: null,
            }),
        ]);
    });

    // D1 binds at most 100 parameters to one statement, which a multi-row insert of a day's photos overruns
    it('issues URLs for a whole day of photos at once', async () => {
        const paths = Array.from({ length: 60 }, (_, index) => `${DAY}photo_${index}`);
        const response = await presign(
            DAY,
            paths.map((path) => ({ path })),
        );
        const uploads = await parseExactly(response, parsePresigned);
        const rows = await orm(env.DB).select().from(schema.upload).all();

        expect(Object.keys(uploads)).toStrictEqual(paths);
        expect(rows).toHaveLength(60);
    });

    it("takes a replacement under the item's own path, whatever file is coming", async () => {
        const response = await presign(DAY, [{ path: `${DAY}existing`, replace: true }]);
        const uploads = await parseExactly(response, parsePresigned);

        expect(Object.keys(uploads)).toStrictEqual([`${DAY}existing`]);
    });
});
