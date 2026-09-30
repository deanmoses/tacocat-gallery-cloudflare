import { describe, expect, it } from 'vitest';
import { derivativeCopies } from '../../scripts/aws-video-derivatives.ts';
import type { VersionIds } from '../../scripts/version-ids-file.ts';
import { testVersionId } from '../version-id.ts';

const minted = testVersionId('v1');
const ids: VersionIds = {
    '/2004/08-08/sleeping_faces.avi': {
        versionId: minted,
        path: '/2004/08-08/sleeping_faces',
        mediaType: 'video',
        awsVersionId: 's3-v1',
        size: 1000,
        etag: '"md5"',
    },
    '/2004/08-08/milo.jpg': {
        versionId: testVersionId('v2'),
        path: '/2004/08-08/milo',
        mediaType: 'image',
        awsVersionId: 's3-milo',
        size: 1000,
        etag: '"md5"',
    },
};

describe(derivativeCopies, () => {
    it("copies a video's MP4 and poster from under its AWS version to under the version id it was minted", () => {
        const plan = derivativeCopies([{ awsPath: '/2004/08-08/sleeping_faces.avi', awsVersionId: 's3-v1' }], ids);

        expect(plan).toStrictEqual({
            copies: [
                {
                    awsPath: '/2004/08-08/sleeping_faces.avi',
                    path: '/2004/08-08/sleeping_faces',
                    source: 'i/2004/08-08/sleeping_faces.avi/s3-v1/video-transcoded',
                    target: `derived/${minted}/video.mp4`,
                    contentType: 'video/mp4',
                },
                {
                    awsPath: '/2004/08-08/sleeping_faces.avi',
                    path: '/2004/08-08/sleeping_faces',
                    source: 'i/2004/08-08/sleeping_faces.avi/s3-v1/video-poster',
                    target: `derived/${minted}/poster.jpg`,
                    contentType: 'image/jpeg',
                },
            ],
            unpaired: [],
        });
    });

    // AWS made the derivatives from the row's version, and a failed upload can leave S3 holding another as current
    it('leaves out a video whose row names another version than the one its original was copied from', () => {
        const plan = derivativeCopies([{ awsPath: '/2004/08-08/sleeping_faces.avi', awsVersionId: 's3-v0' }], ids);

        expect(plan).toStrictEqual({ copies: [], unpaired: ['/2004/08-08/sleeping_faces.avi'] });
    });

    it('leaves out a video with no version id of its own, or none minted, or minted as a photo', () => {
        const plan = derivativeCopies(
            [
                { awsPath: '/2004/08-08/sleeping_faces.avi', awsVersionId: undefined },
                { awsPath: '/2004/08-08/unminted.mov', awsVersionId: 's3-v1' },
                { awsPath: '/2004/08-08/milo.jpg', awsVersionId: 's3-milo' },
            ],
            ids,
        );

        expect(plan).toStrictEqual({
            copies: [],
            unpaired: ['/2004/08-08/sleeping_faces.avi', '/2004/08-08/unminted.mov', '/2004/08-08/milo.jpg'],
        });
    });
});
