import ExifReader from 'exifreader';
import { orm, upsertItem } from './db';
import { json, pathAfter } from './http';
import { presign } from './s3';
import { transcodeVideo } from './video';

/** Shape of an R2 event notification delivered through a Queue. */
export interface R2EventMessage {
    action: 'PutObject' | 'CopyObject' | 'CompleteMultipartUpload' | 'DeleteObject' | 'LifecycleDeletion';
    bucket: string;
    object: { key: string; size?: number; eTag?: string };
    eventTime: string;
}

/**
 * Stand-in for the browser's presigned PUT: writes straight to R2 so the event notification path can be
 * exercised before S3 API credentials exist.
 */
export async function upload(request: Request, env: Env): Promise<Response> {
    const key = pathAfter(new URL(request.url), '/upload/');
    const contentType = request.headers.get('content-type');
    const object = await env.MEDIA.put(`inbox/${key}`, request.body, {
        httpMetadata: contentType === null ? {} : { contentType },
    });
    return json({ key: object.key, size: object.size });
}

/** Presigned PUT straight to R2's S3 endpoint, so upload bytes never pass through the Worker. */
export async function uploadUrl(request: Request, env: Env): Promise<Response> {
    const { path, contentType } = await request.json<{ path: string; contentType: string }>();
    const url = await presign(env, { method: 'PUT', key: `inbox/${path.replace(/^\//v, '')}`, contentType });
    return json({ url, contentType });
}

/** Moves an inbox upload to its immutable key and records it, mirroring processMediaUpload. */
export async function processUploadEvent(event: R2EventMessage, env: Env): Promise<void> {
    const { key } = event.object;
    if (!key.startsWith('inbox/') || event.action === 'DeleteObject') {
        return;
    }
    const object = await env.MEDIA.get(key);
    if (!object) {
        return;
    }
    const bytes = await object.arrayBuffer();
    // For example "/2024/06-15/photo.jpg".
    const galleryPath = key.slice('inbox'.length);
    const slash = galleryPath.lastIndexOf('/');
    const parentPath = galleryPath.slice(0, slash + 1);
    const itemName = galleryPath.slice(slash + 1);
    const versionId = ulidish();
    const { title, description } = readCaption(bytes, key);

    const originalKey = `originals${galleryPath}/${versionId}`;
    await env.MEDIA.put(originalKey, bytes, { httpMetadata: object.httpMetadata ?? {} });
    const isVideo = /\.(?:avi|m4v|mov|mp4)$/iv.test(itemName);
    const video = isVideo ? await transcodeVideo(env, originalKey, `derived${galleryPath}/${versionId}`) : undefined;
    await upsertItem(orm(env.DB), {
        parentPath,
        itemName,
        itemType: isVideo ? 'video' : 'image',
        title,
        description,
        versionId,
        published: false,
        ...video,
    }).run();
    await env.MEDIA.delete(key);
    console.info({ event: 'upload_processed', galleryPath, versionId, title, description, eventTime: event.eventTime });
}

/** The IPTC title and description, where Lightroom and Photos put them. */
function readCaption(bytes: ArrayBuffer, key: string): { title: string | null; description: string | null } {
    let tags: ExifReader.Tags | undefined;
    try {
        tags = ExifReader.load(bytes, { expanded: false });
    } catch (error) {
        console.error({ event: 'exif_failed', key, error: String(error) });
    }
    return {
        title: tagText(tags?.Headline) ?? tagText(tags?.['title']) ?? tagText(tags?.['ObjectName']),
        description: tagText(tags?.ImageDescription) ?? tagText(tags?.['Caption/Abstract']),
    };
}

function tagText(tag: unknown): string | null {
    if (typeof tag !== 'object' || tag === null || !('description' in tag)) {
        return null;
    }
    const { description } = tag;
    return typeof description === 'string' && description.trim() !== '' ? description.trim() : null;
}

/** Time-sortable, URL-safe id standing in for S3's versionId. */
function ulidish(): string {
    return Date.now().toString(36).padStart(9, '0') + crypto.randomUUID().replaceAll('-', '').slice(0, 16);
}
