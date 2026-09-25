import { isHeicName, isVideoName } from 'tacocat-gallery-shared';

/** Whether a browser can show the file in an `<img>`: neither a HEIC, which only Safari decodes, nor a video. */
export function browserCanDisplay(fileNameOrPath: string): boolean {
    return !isHeicName(fileNameOrPath) && !isVideoName(fileNameOrPath);
}

/** How long to watch for the server to make an upload into an item before giving up. A video is transcoded first. */
export function getProcessingTimeout(fileNameOrPath: string): number {
    return isVideoName(fileNameOrPath) ? VIDEO_PROCESSING_TIMEOUT_MS : IMAGE_PROCESSING_TIMEOUT_MS;
}

const IMAGE_PROCESSING_TIMEOUT_MS = 15_000;
const VIDEO_PROCESSING_TIMEOUT_MS = 180_000;
