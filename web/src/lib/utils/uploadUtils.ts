import { type MediaItemToUpload, type UploadEntry, UploadState } from '$lib/models/album';
import type { Album } from '$lib/models/GalleryItemInterfaces';
import { baseNameOf, extensionOf, sanitizeMediaFilename } from 'tacocat-gallery-shared';

/**
 * The path a file takes when it replaces the item at `targetPath`: the target's base name with the file's extension as
 * the sanitizer spells it, so a PNG dropped on `felix.jpg` becomes `felix.png` and a `.jpeg` re-export keeps the name.
 */
export function replacementPath(targetPath: string, fileName: string): string {
    const cut = targetPath.lastIndexOf('/') + 1;
    const baseName = baseNameOf(targetPath.slice(cut));
    return `${targetPath.slice(0, cut)}${baseName}.${extensionOf(sanitizeMediaFilename(fileName))}`;
}

export interface ProcessedUploadsResult {
    /** The paths of the uploads the album now holds */
    processed: string[];
    allProcessed: boolean;
}

/**
 * Which uploads the server has made into items: the ones whose version id the album now carries. A replacement in
 * another format lands under a new name, so the version is what is looked for, never the path.
 */
export function findProcessedUploads(
    uploads: UploadEntry[],
    albumHasVersion: (versionId: string) => boolean,
): ProcessedUploadsResult {
    const processed: string[] = [];
    let allProcessed = true;
    for (const upload of uploads) {
        if (
            upload.status === UploadState.PROCESSING &&
            upload.versionId !== undefined &&
            albumHasVersion(upload.versionId)
        ) {
            processed.push(upload.path);
        } else {
            allProcessed = false;
        }
    }
    return { processed, allProcessed };
}

/**
 * Marks each file whose name an item in the album already holds as replacing that item, which the server refuses an
 * upload under a taken name without, and returns those files' names for the admin to confirm. An album not loaded
 * yet has nothing to collide with.
 */
export function markReplacements(files: MediaItemToUpload[], album: Album | undefined): string[] {
    const collidingNames: string[] = [];
    for (const file of files) {
        const media = album?.getMedia(file.path);
        if (media) {
            collidingNames.push(file.file.name);
            file.replaces = media.path;
        }
    }
    return collidingNames;
}
