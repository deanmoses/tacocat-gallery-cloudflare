import { type MediaItemToUpload, type UploadEntry, UploadState } from '$lib/models/album';
import type { Album } from '$lib/models/GalleryItemInterfaces';
import { isVideoFile } from '@tacocat-gallery/shared';
import { getMedia } from '$lib/utils/albumNavigation';

/**
 * The paths of the uploads the server has made into items: the ones whose version id the album now carries. The
 * version is what is looked for, never the path, since an item may be renamed while its upload is in flight.
 */
export function findProcessedUploads(
    uploads: UploadEntry[],
    albumHasVersion: (versionId: string) => boolean,
): string[] {
    return uploads
        .filter(
            (upload) =>
                upload.status === UploadState.PROCESSING &&
                upload.versionId !== undefined &&
                albumHasVersion(upload.versionId),
        )
        .map((upload) => upload.path);
}

/**
 * Marks each file whose name an item in the album already holds as replacing that item, which the server refuses an
 * upload under a taken name without, and returns a line per collision for the admin to confirm: the item's name, as
 * the album shows it. A Live Photo's still and clip come out under one name, so a line says the kinds and the file
 * when they differ, and an admin who took the question to be about an edited copy of the photo is not handed a
 * three-second clip in its place. An album not loaded yet has nothing to collide with.
 */
export function markReplacements(files: MediaItemToUpload[], album: Album | undefined): string[] {
    const collisions: string[] = [];
    for (const file of files) {
        const media = getMedia(album, file.path);
        if (media) {
            file.replace = true;
            const name = media.path.split('/').pop() ?? '';
            const incoming = isVideoFile(file.file.name) ? 'video' : 'photo';
            const existing = media.mediaType === 'video' ? 'video' : 'photo';
            collisions.push(
                incoming === existing ? name : `${name} (a ${existing}; ${file.file.name} is a ${incoming})`,
            );
        }
    }
    return collisions;
}
