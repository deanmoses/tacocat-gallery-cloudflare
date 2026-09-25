import { describe, expect, it } from 'vitest';
import { browserCanDisplay, getProcessingTimeout } from './fileFormats';
import { VIDEO_EXTENSIONS } from './galleryPathUtils';

interface FormatCase {
    path: string;
    /** Whether a browser can render the file in an <img> */
    canDisplay: boolean;
    /** How long to wait for the server to finish processing */
    timeoutMs: number;
}

const IMAGE_TIMEOUT_MS = 15_000;

/** Longer than an image's, because the server transcodes video */
const VIDEO_TIMEOUT_MS = 180_000;

const IMAGE_CASES: FormatCase[] = [
    '/2024/01-01/photo.jpg',
    '/2024/01-01/photo.png',
    '/2024/01-01/photo.gif',
    // The last extension decides, so a format name earlier in the file name means nothing
    '/2024/01-01/photo.heic.jpg',
    '/2024/01-01/photo.mp4.png',
    // Unknown and absent extensions take the image defaults; something else refuses them
    '/2024/01-01/notes.txt',
    '/2024/01-01/photo',
].map((path) => ({ path, canDisplay: true, timeoutMs: IMAGE_TIMEOUT_MS }));

/** Stored as uploaded, and shown by no browser but Safari */
const HEIC_CASES: FormatCase[] = ['photo.heic', 'photo.heif', 'photo.HEIC', 'photo.HEIF'].map((name) => ({
    path: `/2024/01-01/${name}`,
    canDisplay: false,
    timeoutMs: IMAGE_TIMEOUT_MS,
}));

/** Every video extension the gallery takes, in either case, so an extension added to the list is held to the same answers */
const VIDEO_CASES: FormatCase[] = [...VIDEO_EXTENSIONS, 'MP4', 'MOV'].map((ext) => ({
    path: `/2024/01-01/video.${ext}`,
    canDisplay: false,
    timeoutMs: VIDEO_TIMEOUT_MS,
}));

const ALL_CASES: FormatCase[] = [...IMAGE_CASES, ...HEIC_CASES, ...VIDEO_CASES];

describe(browserCanDisplay, () => {
    it.each(ALL_CASES)('$path displayable in a browser: $canDisplay', ({ path, canDisplay }) => {
        expect(browserCanDisplay(path)).toBe(canDisplay);
    });

    // Callers hold a File in one place and an album path in another
    it.each(['photo.jpg', 'photo.heic', 'video.mp4'])('answers the same for the bare file name %s', (fileName) => {
        expect(browserCanDisplay(fileName)).toBe(browserCanDisplay(`/2024/01-01/${fileName}`));
    });
});

describe(getProcessingTimeout, () => {
    it.each(ALL_CASES)('$path waits $timeoutMs ms for processing', ({ path, timeoutMs }) => {
        expect(getProcessingTimeout(path)).toBe(timeoutMs);
    });
});
