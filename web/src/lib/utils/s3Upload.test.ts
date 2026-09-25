import { describe, expect, it } from 'vitest';
import { fakeServer, jsonResponse } from '$lib/test-support/http';
import { fetchPresignedUrls, uploadToS3 } from './s3Upload';

const ALBUM = '/2024/06-15/';
const ROUTE = `/api/presigned${ALBUM}`;

describe(fetchPresignedUrls, () => {
    it('tells the server what each upload is and reads back where to put it and the version it will have', async () => {
        const server = fakeServer();
        const presigned = { url: 'https://bucket.test/inbox/v9?signed', versionId: 'v9' };
        server.post(ROUTE, jsonResponse({ [`${ALBUM}photo.png`]: presigned }));

        const result = await fetchPresignedUrls(ALBUM, [{ path: `${ALBUM}photo.png`, replaces: `${ALBUM}photo.jpg` }]);

        expect(result).toStrictEqual({ success: true, uploads: { [`${ALBUM}photo.png`]: presigned } });
        expect(server.calls).toStrictEqual([
            { method: 'POST', pathname: ROUTE, body: [{ path: `${ALBUM}photo.png`, replaces: `${ALBUM}photo.jpg` }] },
        ]);
    });

    it("passes on the server's reason for refusing", async () => {
        const server = fakeServer();
        server.post(
            ROUTE,
            jsonResponse({ errorMessage: 'A media item already exists at [/2024/06-15/photo.png]' }, 400),
        );

        const result = await fetchPresignedUrls(ALBUM, [{ path: `${ALBUM}photo.png` }]);

        expect(result).toStrictEqual({
            success: false,
            error: 'A media item already exists at [/2024/06-15/photo.png]',
        });
    });

    it('fails on a reply that is not a map of uploads', async () => {
        const server = fakeServer();
        server.post(ROUTE, jsonResponse({ [`${ALBUM}photo.png`]: 'https://bucket.test/inbox/v9?signed' }));

        const result = await fetchPresignedUrls(ALBUM, [{ path: `${ALBUM}photo.png` }]);

        expect(result).toMatchObject({ success: false });
    });
});

describe(uploadToS3, () => {
    it("PUTs the file to the URL with the file's own content type", async () => {
        const server = fakeServer();
        server.put('/inbox/v9', new Response(null, { status: 200 }));
        const file = new File(['bytes'], 'photo.png', { type: 'image/png' });

        const result = await uploadToS3(file, 'https://bucket.test/inbox/v9?signed');
        const [put] = server.rawCalls;

        expect(result).toStrictEqual({ success: true });
        expect(put?.init?.method).toBe('PUT');
        expect(new Headers(put?.init?.headers).get('content-type')).toBe('image/png');
    });

    it('reports a refused PUT by its status text', async () => {
        const server = fakeServer();
        server.put('/inbox/v9', new Response(null, { status: 403, statusText: 'Forbidden' }));

        const result = await uploadToS3(new File([], 'photo.png'), 'https://bucket.test/inbox/v9?signed');

        expect(result).toStrictEqual({ success: false, error: 'Forbidden' });
    });
});
