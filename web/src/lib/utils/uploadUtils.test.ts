import { describe, expect, it } from 'vitest';
import { findProcessedUploads, markReplacements } from './uploadUtils';
import { type MediaItemToUpload, type UploadEntry, UploadState } from '$lib/models/album';
import { dayAlbum, imageRecord, mediaPath, videoRecord } from '$lib/test-support/records';
import type { Album } from '$lib/models/GalleryItemInterfaces';

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
    return { file: new File([], fileName), path: mediaPath(fileName.slice(0, fileName.lastIndexOf('.'))) };
}

/** The media already in the album, under the names an upload might collide with */
const albumWithPhotoAndClip = (): Album =>
    dayAlbum([
        imageRecord({ mediaType: 'image', path: mediaPath('photo'), itemName: 'photo', versionId: 'photo-v1' }),
        videoRecord({ path: mediaPath('clip'), itemName: 'clip', versionId: 'clip-v1' }),
    ]);

describe(markReplacements, () => {
    it('reports nothing for a batch that collides with nothing', () => {
        const files = [mediaToUpload('new.jpg')];

        expect(markReplacements(files, albumWithPhotoAndClip())).toStrictEqual([]);
        expect(files[0]?.replace).toBeUndefined();
    });

    // The name is what the admin is shown in the confirmation dialog, so it is the file's own name rather than its path
    it('names a colliding file and marks it as a replacement', () => {
        const files = [mediaToUpload('photo.jpg')];

        expect(markReplacements(files, albumWithPhotoAndClip())).toStrictEqual(['photo.jpg']);
        expect(files[0]?.replace).toBe(true);
    });

    // Any file may replace any item, so a file in another format collides with the item of its name
    it('matches a file against the item of its name whatever format either is in', () => {
        const files = [mediaToUpload('photo.heic')];

        expect(markReplacements(files, albumWithPhotoAndClip())).toStrictEqual(['photo.heic']);
        expect(files[0]?.replace).toBe(true);
    });

    // A Live Photo's clip lands on its still: the line says so, since the admin may have taken the question to be about an edited photo
    it('says the kinds when a video would replace a photo, or a photo a video', () => {
        const files = [mediaToUpload('photo.mov'), mediaToUpload('clip.jpg')];

        expect(markReplacements(files, albumWithPhotoAndClip())).toStrictEqual([
            'photo.mov (a video, replacing the photo photo)',
            'clip.jpg (a photo, replacing the video clip)',
        ]);
    });

    it('checks every file in the batch, and leaves the ones that collide with nothing alone', () => {
        const files = [mediaToUpload('new.jpg'), mediaToUpload('photo.jpg'), mediaToUpload('clip.mp4')];

        expect(markReplacements(files, albumWithPhotoAndClip())).toStrictEqual(['photo.jpg', 'clip.mp4']);
        expect(files.map((file) => file.replace)).toStrictEqual([undefined, true, true]);
    });

    // The check can run before the album has loaded, so an absent or empty album means no collisions rather than an error
    it.each([
        { description: 'no album loaded', album: undefined },
        { description: 'an empty album', album: dayAlbum([]) },
    ])('reports no collisions against $description', ({ album }) => {
        const files = [mediaToUpload('photo.jpg')];

        expect(markReplacements(files, album)).toStrictEqual([]);
        expect(files[0]?.replace).toBeUndefined();
    });
});
