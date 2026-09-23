import { describe, it, expect } from 'vitest';
import { isAlbumRecord, isMediaRecord, isImageRecord, isVideoRecord } from './server';
import type { GalleryRecord } from './server';
import { albumRecord, imageRecord, videoRecord } from '$lib/test-support/records';

type GuardCase = {
    description: string;
    record: GalleryRecord;
    isAlbum: boolean;
    isMedia: boolean;
    isImage: boolean;
    isVideo: boolean;
};

const CASES: GuardCase[] = [
    { description: 'album', record: albumRecord(), isAlbum: true, isMedia: false, isImage: false, isVideo: false },
    { description: 'image', record: imageRecord(), isAlbum: false, isMedia: true, isImage: true, isVideo: false },
    { description: 'video', record: videoRecord(), isAlbum: false, isMedia: true, isImage: false, isVideo: true },
];

describe(isAlbumRecord, () => {
    it.each(CASES)('$description: $isAlbum', ({ record, isAlbum }) => {
        expect(isAlbumRecord(record)).toBe(isAlbum);
    });
});

describe(isMediaRecord, () => {
    it.each(CASES)('$description: $isMedia', ({ record, isMedia }) => {
        expect(isMediaRecord(record)).toBe(isMedia);
    });
});

describe(isImageRecord, () => {
    it.each(CASES)('$description: $isImage', ({ record, isImage }) => {
        expect(isImageRecord(record)).toBe(isImage);
    });
});

describe(isVideoRecord, () => {
    it.each(CASES)('$description: $isVideo', ({ record, isVideo }) => {
        expect(isVideoRecord(record)).toBe(isVideo);
    });
});
