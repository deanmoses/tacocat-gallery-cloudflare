import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, extensionOf, isHeicFile, isVideoFile } from 'tacocat-gallery-shared';

const EXTENSIONS: readonly string[] = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS];

/** Whether a file's name carries an extension the gallery takes an upload of. */
export function isMediaFile(fileName: string): boolean {
    return fileName.includes('.') && EXTENSIONS.includes(extensionOf(fileName));
}

/** What the file picker is told it may offer: `.jpg, .jpeg, .png, ...` */
export function acceptedExtensions(): string {
    return EXTENSIONS.map((extension) => `.${extension}`).join(', ');
}

/** Whether a browser can show the file in an `<img>`: neither a HEIC, which only Safari decodes, nor a video. */
export function browserCanDisplay(fileName: string): boolean {
    return !isHeicFile(fileName) && !isVideoFile(fileName);
}

/** How long to watch for the server to make an upload into an item before giving up. A video is transcoded first. */
export function processingTimeout(fileName: string): number {
    return isVideoFile(fileName) ? VIDEO_PROCESSING_TIMEOUT_MS : IMAGE_PROCESSING_TIMEOUT_MS;
}

const IMAGE_PROCESSING_TIMEOUT_MS = 15_000;
const VIDEO_PROCESSING_TIMEOUT_MS = 180_000;
