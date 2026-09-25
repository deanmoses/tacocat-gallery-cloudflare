import { describe, expect, it } from 'vitest';
import { findProcessedUploads, markReplacements, replacementPath } from './uploadUtils';
import { type MediaItemToUpload, type UploadEntry, UploadState } from '$lib/models/album';
import { dayAlbum, imageRecord, mediaPath, videoRecord } from '$lib/test-support/records';
import type { Album } from '$lib/models/GalleryItemInterfaces';

describe(replacementPath, () => {
    it.each([
        // The same format keeps the path
        { targetPath: '/2024/01-01/photo.jpg', fileName: 'new.jpg', path: '/2024/01-01/photo.jpg' },
        { targetPath: '/2024/01-01/video.mp4', fileName: 'new.mp4', path: '/2024/01-01/video.mp4' },
        // Another format keeps the name and takes the extension: any file may replace any item
        { targetPath: '/2024/01-01/photo.jpg', fileName: 'new.png', path: '/2024/01-01/photo.png' },
        { targetPath: '/2024/01-01/photo.jpg', fileName: 'new.heic', path: '/2024/01-01/photo.heic' },
        { targetPath: '/2024/01-01/photo.jpg', fileName: 'clip.mov', path: '/2024/01-01/photo.mov' },
        { targetPath: '/2024/01-01/image.png', fileName: 'new.jpg', path: '/2024/01-01/image.jpg' },
        // The extension is spelled as the sanitizer spells it, so a JPEG is always .jpg
        { targetPath: '/2024/01-01/photo.jpg', fileName: 'new.JPG', path: '/2024/01-01/photo.jpg' },
        { targetPath: '/2024/01-01/photo.jpg', fileName: 'new.jpeg', path: '/2024/01-01/photo.jpg' },
        { targetPath: '/2024/01-01/photo.png', fileName: 'new.JPEG', path: '/2024/01-01/photo.jpg' },
        { targetPath: '/2024/01-01/photo.jpg', fileName: 'new.HEIC', path: '/2024/01-01/photo.heic' },
        // The target's name is kept as it is, older unsanitized names included, since the server keys the item by it
        { targetPath: '/2024/01-01/Old-Photo.JPG', fileName: 'new.png', path: '/2024/01-01/Old-Photo.png' },
        // Only the last dot of the file's name separates its extension; the target has one dot by the gallery's rule
        { targetPath: '/2024/01-01/photo.jpg', fileName: 'new.2024.heic', path: '/2024/01-01/photo.heic' },
    ])('$fileName onto $targetPath goes to $path', ({ targetPath, fileName, path }) => {
        expect(replacementPath(targetPath, fileName)).toBe(path);
    });
});

function upload(fields: { path: string; status: UploadState; versionId?: string }): UploadEntry {
    return { file: new File([], 'test.jpg'), ...fields };
}

describe(findProcessedUploads, () => {
    const PHOTO = '/2024/01-01/photo.jpg';

    it.each([
        {
            description: 'the album carries the uploaded version',
            upload: upload({ path: PHOTO, status: UploadState.PROCESSING, versionId: 'v1' }),
            albumVersions: ['v1'],
            processed: true,
        },
        {
            description: 'the album does not have it yet',
            upload: upload({ path: PHOTO, status: UploadState.PROCESSING, versionId: 'v1' }),
            albumVersions: [],
            processed: false,
        },
        {
            description: 'the album still has the version being replaced',
            upload: upload({ path: PHOTO, status: UploadState.PROCESSING, versionId: 'v1' }),
            albumVersions: ['v0'],
            processed: false,
        },
        // Nothing is complete before it has reached the bucket, whatever the album says
        {
            description: 'not started',
            upload: upload({ path: PHOTO, status: UploadState.UPLOAD_NOT_STARTED, versionId: 'v1' }),
            albumVersions: ['v1'],
            processed: false,
        },
        {
            description: 'still uploading',
            upload: upload({ path: PHOTO, status: UploadState.UPLOADING, versionId: 'v1' }),
            albumVersions: ['v1'],
            processed: false,
        },
        {
            description: 'processing with no version recorded',
            upload: upload({ path: PHOTO, status: UploadState.PROCESSING }),
            albumVersions: ['v1'],
            processed: false,
        },
    ])('$description: $processed', ({ upload: entry, albumVersions, processed }) => {
        const result = findProcessedUploads([entry], (versionId) => albumVersions.includes(versionId));

        expect(result.processed).toStrictEqual(processed ? [entry.path] : []);
        expect(result.allProcessed).toBe(processed);
    });

    it('reports nothing to do for an empty batch', () => {
        const result = findProcessedUploads([], (versionId) => {
            throw new Error(`Looked up ${versionId} with nothing to look for`);
        });

        expect(result.processed).toStrictEqual([]);
        expect(result.allProcessed).toBe(true);
    });

    // The album is polled until allProcessed, with different items finished on each pass, so every entry is
    // considered on every pass: an unfinished one must not hide the finished ones behind it
    it('reports the finished uploads in order, wherever the unfinished ones sit', () => {
        const uploads = [
            upload({ path: '/2024/01-01/pending.jpg', status: UploadState.PROCESSING, versionId: 'v1' }),
            upload({ path: '/2024/01-01/done1.jpg', status: UploadState.PROCESSING, versionId: 'v2' }),
            upload({ path: '/2024/01-01/uploading.jpg', status: UploadState.UPLOADING }),
            upload({ path: '/2024/01-01/done2.jpg', status: UploadState.PROCESSING, versionId: 'v4' }),
        ];
        const album = new Set(['v2', 'v4']);

        const result = findProcessedUploads(uploads, (versionId) => album.has(versionId));

        expect(result.processed).toStrictEqual(['/2024/01-01/done1.jpg', '/2024/01-01/done2.jpg']);
        expect(result.allProcessed).toBe(false);
    });

    // A replacement in another format lands under a new name, so the path says nothing about whether it is done
    it('finds a replacement that the server renamed, by its version alone', () => {
        const entry = upload({ path: '/2024/01-01/photo.png', status: UploadState.PROCESSING, versionId: 'v1' });

        const result = findProcessedUploads([entry], (versionId) => versionId === 'v1');

        expect(result.processed).toStrictEqual(['/2024/01-01/photo.png']);
        expect(result.allProcessed).toBe(true);
    });
});

function mediaToUpload(fileName: string): MediaItemToUpload {
    return { file: new File([], fileName), path: mediaPath(fileName) };
}

/** The media already in the album, under the names an upload might collide with */
const albumWithPhotoAndClip = (): Album =>
    dayAlbum([
        imageRecord({ mediaType: 'image', path: mediaPath('photo.jpg'), itemName: 'photo.jpg', versionId: 'photo-v1' }),
        videoRecord({ path: mediaPath('clip.mp4'), itemName: 'clip.mp4', versionId: 'clip-v1' }),
    ]);

describe(markReplacements, () => {
    it('reports nothing for a batch that collides with nothing', () => {
        const files = [mediaToUpload('new.jpg')];

        expect(markReplacements(files, albumWithPhotoAndClip())).toStrictEqual([]);
        expect(files[0]?.replaces).toBeUndefined();
    });

    // The name is what the admin is shown in the confirmation dialog, so it is the file's own name rather than its path
    it('names a colliding file and marks what it replaces', () => {
        const files = [mediaToUpload('photo.jpg')];

        expect(markReplacements(files, albumWithPhotoAndClip())).toStrictEqual(['photo.jpg']);
        expect(files[0]?.replaces).toBe(mediaPath('photo.jpg'));
    });

    // A HEIC is stored as a HEIC, so it collides with nothing but another HEIC of the same name
    it('does not match a file against an item of the same name in another format', () => {
        const files = [mediaToUpload('photo.heic')];

        expect(markReplacements(files, albumWithPhotoAndClip())).toStrictEqual([]);
        expect(files[0]?.replaces).toBeUndefined();
    });

    it('checks every file in the batch, and leaves the ones that collide with nothing alone', () => {
        const files = [mediaToUpload('new.jpg'), mediaToUpload('photo.jpg'), mediaToUpload('clip.mp4')];

        expect(markReplacements(files, albumWithPhotoAndClip())).toStrictEqual(['photo.jpg', 'clip.mp4']);
        expect(files.map((file) => file.replaces)).toStrictEqual([
            undefined,
            mediaPath('photo.jpg'),
            mediaPath('clip.mp4'),
        ]);
    });

    // The check can run before the album has loaded, so an absent or empty album means no collisions rather than an error
    it.each([
        { description: 'no album loaded', album: undefined },
        { description: 'an empty album', album: dayAlbum([]) },
    ])('reports no collisions against $description', ({ album }) => {
        const files = [mediaToUpload('photo.jpg')];

        expect(markReplacements(files, album)).toStrictEqual([]);
        expect(files[0]?.replaces).toBeUndefined();
    });
});
