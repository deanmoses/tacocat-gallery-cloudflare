import { describe, expect, it } from 'vitest';
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from 'tacocat-gallery-shared';
import { acceptedExtensions, browserCanDisplay, isMediaFile, processingTimeout } from './fileFormats';

interface FormatCase {
    fileName: string;
    /** Whether a browser can render the file in an <img> */
    canDisplay: boolean;
    /** How long to wait for the server to finish processing */
    timeoutMs: number;
}

const IMAGE_TIMEOUT_MS = 15_000;

/** Longer than an image's, because the server transcodes video */
const VIDEO_TIMEOUT_MS = 180_000;

const IMAGE_CASES: FormatCase[] = [
    'photo.jpg',
    'photo.png',
    'photo.gif',
    // The last extension decides, so a format name earlier in the file name means nothing
    'photo.heic.jpg',
    'photo.mp4.png',
    // Unknown and absent extensions take the image defaults; something else refuses them
    'notes.txt',
    'photo',
].map((fileName) => ({ fileName, canDisplay: true, timeoutMs: IMAGE_TIMEOUT_MS }));

/** Stored as uploaded, and shown by no browser but Safari */
const HEIC_CASES: FormatCase[] = ['photo.heic', 'photo.heif', 'photo.HEIC', 'photo.HEIF'].map((fileName) => ({
    fileName,
    canDisplay: false,
    timeoutMs: IMAGE_TIMEOUT_MS,
}));

/** Every video extension the gallery takes, in either case, so an extension added to the list is held to the same answers */
const VIDEO_CASES: FormatCase[] = [...VIDEO_EXTENSIONS, 'MP4', 'MOV'].map((ext) => ({
    fileName: `video.${ext}`,
    canDisplay: false,
    timeoutMs: VIDEO_TIMEOUT_MS,
}));

const ALL_CASES: FormatCase[] = [...IMAGE_CASES, ...HEIC_CASES, ...VIDEO_CASES];

describe(isMediaFile, () => {
    it.each([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS])('accepts a file named .%s, in either case', (ext) => {
        expect(isMediaFile(`photo.${ext}`)).toBe(true);
        expect(isMediaFile(`photo.${ext.toUpperCase()}`)).toBe(true);
    });

    it.each(['notes.txt', 'photo', 'photo.', '.jpg.bak', 'archive.jpg.zip'])('refuses %s', (fileName) => {
        expect(isMediaFile(fileName)).toBe(false);
    });
});

describe(acceptedExtensions, () => {
    it('lists every supported extension, dotted and comma-separated', () => {
        expect(acceptedExtensions()).toBe(
            '.jpg, .jpeg, .png, .gif, .heic, .heif, .mp4, .mov, .avi, .mkv, .webm, .m4v, .3gp, .mpg, .mpeg',
        );
    });
});

describe(browserCanDisplay, () => {
    it.each(ALL_CASES)('$fileName displayable in a browser: $canDisplay', ({ fileName, canDisplay }) => {
        expect(browserCanDisplay(fileName)).toBe(canDisplay);
    });
});

describe(processingTimeout, () => {
    it.each(ALL_CASES)('$fileName waits $timeoutMs ms for processing', ({ fileName, timeoutMs }) => {
        expect(processingTimeout(fileName)).toBe(timeoutMs);
    });
});
