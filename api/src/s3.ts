import { AwsClient } from 'aws4fetch';

const R2_S3_ENDPOINT = 'https://ed3ca575118099486baeb129959697c8.r2.cloudflarestorage.com';

/** Presigned S3 URL into the media bucket, so upload and transcode bytes never pass through the Worker. */
export async function presign(
    config: { R2_ACCESS_KEY_ID: string; R2_SECRET_ACCESS_KEY: string; MEDIA_BUCKET: string },
    request: { method: 'GET' | 'PUT'; key: string; contentType?: string },
): Promise<string> {
    const client = new AwsClient({
        accessKeyId: config.R2_ACCESS_KEY_ID,
        secretAccessKey: config.R2_SECRET_ACCESS_KEY,
        service: 's3',
        region: 'auto',
    });
    const target = new URL(
        `${R2_S3_ENDPOINT}/${config.MEDIA_BUCKET}/${request.key
            .split('/')
            .map((segment) => encodeURIComponent(segment))
            .join('/')}`,
    );
    target.searchParams.set('X-Amz-Expires', '3600');
    const unsigned = new Request(target, {
        method: request.method,
        ...(request.contentType !== undefined && { headers: { 'content-type': request.contentType } }),
    });
    const signed = await client.sign(unsigned, { aws: { signQuery: true } });
    return signed.url;
}
