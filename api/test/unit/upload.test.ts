import { describe, expect, it } from 'vitest';
import { transcodeJob } from '../../src/gallery/upload';

describe(transcodeJob, () => {
    it('signs a read of the original and writes of both outputs in the derived bucket', async () => {
        const env = {
            R2_ACCESS_KEY_ID: 'test-access-key',
            R2_SECRET_ACCESS_KEY: 'test-secret-key',
            ORIGINALS_BUCKET: 'test-originals',
            DERIVED_BUCKET: 'test-derived',
        };

        const { versionId, sourceKey, ...urls } = await transcodeJob(env, 'v1');
        const paths = Object.fromEntries(Object.entries(urls).map(([name, url]) => [name, new URL(url).pathname]));

        expect(versionId).toBe('v1');
        expect(sourceKey).toBe('originals/v1');
        expect(paths).toStrictEqual({
            src: '/test-originals/originals/v1',
            mp4Put: '/test-derived/derived/v1/video.mp4',
            posterPut: '/test-derived/derived/v1/poster.jpg',
        });
    });
});
