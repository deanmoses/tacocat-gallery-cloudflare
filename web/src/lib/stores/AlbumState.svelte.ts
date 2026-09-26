import {
    type AlbumActivity,
    type AlbumEntry,
    type CreateEntry,
    CreateStatus,
    CropStatus,
    DeleteStatus,
    type MediaActivity,
} from '$lib/models/album';
import type { CropEntry, DeleteEntry, ReloadStatus, RenameEntry, UploadEntry } from '$lib/models/album';
import type { Album } from '$lib/models/GalleryItemInterfaces';
import { getParentFromPath } from '$lib/utils/galleryPathUtils';
import { SvelteMap } from 'svelte/reactivity';

/**
 * The state of all albums and media
 */
class AlbumState {
    editMode = $state(false);
    albums = new SvelteMap<string, AlbumEntry>();
    albumUpdates = new SvelteMap<string, ReloadStatus>();
    albumCreates = new SvelteMap<string, CreateEntry>();
    albumRenames = new SvelteMap<string, RenameEntry>();
    albumDeletes = new SvelteMap<string, DeleteEntry>();
    mediaRenames = new SvelteMap<string, RenameEntry>();
    mediaDeletes = new SvelteMap<string, DeleteEntry>();
    crops = new SvelteMap<string, CropEntry>();
    uploads: UploadEntry[] = $state([]);
}
export const albumState = new AlbumState();

//
// convenience functions
//

export function getUploadsForAlbum(albumPath: string): UploadEntry[] {
    return albumState.uploads.filter((upload) => upload.path.startsWith(albumPath));
}

export function getUpload(mediaPath: string): UploadEntry | undefined {
    return albumState.uploads.find((upload) => upload.path === mediaPath);
}

/** The album's parent, if it has loaded. The root has none. */
export function getParentAlbum(albumPath: string): Album | undefined {
    return albumState.albums.get(getParentFromPath(albumPath))?.album;
}

export function albumActivity(albumPath: string): AlbumActivity {
    return {
        creating: albumState.albumCreates.get(albumPath)?.status === CreateStatus.IN_PROGRESS,
        deleting: albumState.albumDeletes.get(albumPath)?.status === DeleteStatus.IN_PROGRESS,
        renaming: albumState.albumRenames.has(albumPath),
    };
}

export function mediaActivity(mediaPath: string): MediaActivity {
    return {
        deleting: albumState.mediaDeletes.get(mediaPath)?.status === DeleteStatus.IN_PROGRESS,
        renaming: albumState.mediaRenames.has(mediaPath),
        cropping: albumState.crops.get(mediaPath)?.status === CropStatus.IN_PROGRESS,
    };
}

/** The rename an album is part of, under its old path or its new one, so the page it moves to sees it as well. */
export function getAlbumRename(albumPath: string): RenameEntry | undefined {
    return (
        albumState.albumRenames.get(albumPath) ??
        [...albumState.albumRenames.values()].find((rename) => rename.newPath === albumPath)
    );
}

/** The rename a media item is part of, under its old path or its new one, so the page it moves to sees it as well. */
export function getMediaRename(mediaPath: string): RenameEntry | undefined {
    return (
        albumState.mediaRenames.get(mediaPath) ??
        [...albumState.mediaRenames.values()].find((rename) => rename.newPath === mediaPath)
    );
}
