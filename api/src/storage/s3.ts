import { AwsClient } from 'aws4fetch';

// R2's S3 API, for the two things the bucket bindings cannot do: hand a browser or the transcoder container a URL it
// can read or write an object through on its own, and reach a bucket from a script running outside the Worker.

const R2_S3_ENDPOINT = 'https://ed3ca575118099486baeb129959697c8.r2.cloudflarestorage.com';

export interface S3Credentials {
    R2_ACCESS_KEY_ID: string;
    R2_SECRET_ACCESS_KEY: string;
}

export interface S3Request {
    method: 'GET' | 'PUT';
    bucket: string;
    key: string;
    contentType?: string;
}

/** An object as a listing describes it. */
export interface ListedObject {
    key: string;
    size: number;
    /** When it was written, as R2 reports it. */
    uploaded: string;
}

/** Presigned URL for one request, good for an hour, so upload and transcode bytes never pass through the Worker. */
export async function presign(credentials: S3Credentials, request: S3Request): Promise<string> {
    const target = s3Url(request.bucket, request.key);
    target.searchParams.set('X-Amz-Expires', '3600');
    const unsigned = new Request(target, {
        method: request.method,
        ...(request.contentType !== undefined && { headers: { 'content-type': request.contentType } }),
    });
    const signed = await client(credentials).sign(unsigned, { aws: { signQuery: true } });
    return signed.url;
}

/**
 * The objects under `prefix`, up to the first thousand: what one version has, not a whole bucket, which the Worker
 * lists through its binding.
 */
export async function listObjects(credentials: S3Credentials, bucket: string, prefix: string): Promise<ListedObject[]> {
    const target = s3Url(bucket, '');
    target.searchParams.set('list-type', '2');
    target.searchParams.set('prefix', prefix);
    const response = await client(credentials).fetch(target.href);
    if (!response.ok) {
        throw new Error(`listing ${bucket}/${prefix} failed: ${response.status} ${await response.text()}`);
    }
    const xml = await response.text();
    return [...xml.matchAll(/<Contents>(?<entry>.*?)<\/Contents>/gsv)].map(({ groups }) => {
        const entry = groups?.['entry'] ?? '';
        return {
            key: field(entry, 'Key'),
            size: Number(field(entry, 'Size')),
            uploaded: field(entry, 'LastModified'),
        };
    });
}

function field(entry: string, name: string): string {
    return new RegExp(`<${name}>(?<value>.*?)</${name}>`, 'sv').exec(entry)?.groups?.['value'] ?? '';
}

function client(credentials: S3Credentials): AwsClient {
    return new AwsClient({
        accessKeyId: credentials.R2_ACCESS_KEY_ID,
        secretAccessKey: credentials.R2_SECRET_ACCESS_KEY,
        service: 's3',
        region: 'auto',
    });
}

/** `key` in `bucket`, each segment escaped, so a key with a space or a non-ASCII name signs and resolves as one URL. */
function s3Url(bucket: string, key: string): URL {
    const path = key
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
    return new URL(`${R2_S3_ENDPOINT}/${bucket}/${path}`);
}
